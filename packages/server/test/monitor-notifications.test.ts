import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { ChatRepository } from "../src/repository.js";

type MonitorNotificationRecord = {
  id: string;
  eventId: string;
  monitorId: string;
  provider: string;
  eventType: string;
  title: string;
  payload: unknown;
  sourceKey: string;
  status: string;
  createdAt: string;
  readAt: string | null;
};

type MonitorRepository = ChatRepository & {
  createMonitorNotification?: (input: {
    monitorId: string;
    provider: string;
    eventType: string;
    title: string;
    payload?: unknown;
    sourceKey: string;
  }) => Promise<MonitorNotificationRecord>;
  listMonitorNotifications?: () => Promise<MonitorNotificationRecord[]>;
};

function createBroadcaster() {
  const listeners = new Set<(notification: MonitorNotificationRecord) => void>();

  return {
    publish(notification: MonitorNotificationRecord) {
      for (const listener of listeners) {
        listener(notification);
      }
    },
    subscribe(listener: (notification: MonitorNotificationRecord) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function createTempDatabasePath() {
  const directory = await mkdtemp(path.join(tmpdir(), "pixelclaw-monitor-db-"));
  return {
    databasePath: path.join(directory, "pixelclaw.sqlite"),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

describe("monitor notifications", () => {
  const apps: Array<{ close: () => Promise<unknown> }> = [];
  const cleanups: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("persists unread monitor notifications in the repository", async () => {
    const database = createDatabase();
    const repository = new ChatRepository(database.daos) as MonitorRepository;

    expect(repository.createMonitorNotification).toBeTypeOf("function");
    expect(repository.listMonitorNotifications).toBeTypeOf("function");

    const created = await repository.createMonitorNotification?.({
      monitorId: "monitor-1",
      provider: "github",
      eventType: "checks.failed",
      title: "owner/repo: checks failed on PR #42",
      payload: { prNumber: 42, repo: "owner/repo" },
      sourceKey: "github:owner/repo:pr-42:checks_failed:sha-1",
    });

    const notifications = await repository.listMonitorNotifications?.();

    expect(created).toMatchObject({
      monitorId: "monitor-1",
      provider: "github",
      eventType: "checks.failed",
      title: "owner/repo: checks failed on PR #42",
      payload: { prNumber: 42, repo: "owner/repo" },
      sourceKey: "github:owner/repo:pr-42:checks_failed:sha-1",
      status: "unread",
      readAt: null,
    });
    expect(notifications).toEqual([created]);

    database.sqlite.close();
  });

  it("lists stored notifications from the HTTP API", async () => {
    const temp = await createTempDatabasePath();
    cleanups.push(temp.cleanup);

    const app = await buildServer({
      databasePath: temp.databasePath,
      telegramBotStarter: async () => null,
    });
    apps.push(app);

    const externalDatabase = createDatabase(temp.databasePath);
    const repository = new ChatRepository(externalDatabase.daos) as MonitorRepository;
    await repository.createMonitorNotification?.({
      monitorId: "monitor-1",
      provider: "github",
      eventType: "comment.created",
      title: "owner/repo: new comment on PR #42",
      payload: { prNumber: 42, repo: "owner/repo" },
      sourceKey: "github:owner/repo:pr-42:comment_created:comment-7",
    });
    externalDatabase.sqlite.close();

    const response = await app.inject({
      method: "GET",
      url: "/api/notifications",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      notifications: [
        expect.objectContaining({
          monitorId: "monitor-1",
          provider: "github",
          eventType: "comment.created",
          title: "owner/repo: new comment on PR #42",
          payload: { prNumber: 42, repo: "owner/repo" },
          status: "unread",
        }),
      ],
    });
  });

  it("streams notification.created events over SSE", async () => {
    const broadcaster = createBroadcaster();
    const app = await buildServer({
      notificationBroadcaster: broadcaster,
      telegramBotStarter: async () => null,
    } as never);
    apps.push(app);

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected Fastify to listen on a TCP port");
    }

    const abortController = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/notifications/stream`, {
      headers: { accept: "text/event-stream" },
      signal: abortController.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    await delay(25);

    broadcaster.publish({
      id: "notification-1",
      eventId: "event-1",
      monitorId: "monitor-1",
      provider: "github",
      eventType: "merge_conflict.detected",
      title: "owner/repo: PR #42 has merge conflicts",
      payload: { prNumber: 42, repo: "owner/repo" },
      sourceKey: "github:owner/repo:pr-42:merge_conflict:sha-1",
      status: "unread",
      createdAt: "2026-03-09T12:00:00.000Z",
      readAt: null,
    });

    const reader = response.body?.getReader();
    const firstChunk = await Promise.race([
      reader?.read(),
      delay(1000).then(() => {
        throw new Error("Timed out waiting for SSE notification");
      }),
    ]);
    abortController.abort();

    const body = new TextDecoder().decode(firstChunk?.value);
    expect(body).toContain("event: notification.created");
    expect(body).toContain('"id":"notification-1"');
    expect(body).toContain('"title":"owner/repo: PR #42 has merge conflicts"');
  });
});
