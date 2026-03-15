import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

function extractCookie(setCookieHeader: string | string[] | undefined, name: string) {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const header of headers) {
    if (!header) {
      continue;
    }
    const [pair] = header.split(";");
    if (!pair) {
      continue;
    }
    const [cookieName, ...rest] = pair.split("=");
    if (cookieName === name) {
      return rest.join("=");
    }
  }
  return undefined;
}

describe("chat backend", () => {
  const apps: Array<{ close: () => Promise<unknown> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("creates an anonymous session and a new thread when posting a chat message", async () => {
    const app = await buildServer();
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Hello from the browser" },
    });

    expect(response.statusCode).toBe(201);
    expect(extractCookie(response.headers["set-cookie"], "pixelclaw_session")).toBeTruthy();

    const payload = response.json();
    expect(payload.threadId).toEqual(expect.any(String));
    expect(payload.runId).toEqual(expect.any(String));
    expect(payload.assistantMessageId).toEqual(expect.any(String));

    const transcript = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${payload.threadId}/messages`,
      headers: {
        cookie: `pixelclaw_session=${extractCookie(response.headers["set-cookie"], "pixelclaw_session")}`,
      },
    });

    expect(transcript.statusCode).toBe(200);
    expect(transcript.json()).toMatchObject({
      threadId: payload.threadId,
      messages: [
        {
          role: "user",
          content: "Hello from the browser",
          status: "completed",
        },
        {
          id: payload.assistantMessageId,
          role: "assistant",
          content: "",
          status: "pending",
        },
      ],
    });
  });

  it("returns the persisted transcript for the current session", async () => {
    const app = await buildServer();
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Remember this thread" },
    });

    const sessionCookie = extractCookie(createResponse.headers["set-cookie"], "pixelclaw_session");
    const { threadId } = createResponse.json();

    const transcript = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(transcript.statusCode).toBe(200);
    expect(transcript.json()).toMatchObject({
      threadId,
      messages: [
        { role: "user", content: "Remember this thread" },
        { role: "assistant", status: "pending" },
      ],
    });
  });

  it("lists threads for the current session", async () => {
    const app = await buildServer();
    apps.push(app);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "First thread" },
    });
    const sessionCookie = extractCookie(firstResponse.headers["set-cookie"], "pixelclaw_session");

    await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Second thread" },
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/chat/threads",
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      threads: [
        {
          title: "New chat",
        },
        {
          title: "New chat",
        },
      ],
    });
    expect(listResponse.json().threads).toHaveLength(2);
  });

  it("streams assistant output and persists the completed assistant message", async () => {
    const app = await buildServer({
      agentRunner: async ({ onEvent }) => {
        onEvent({ type: "run.started" });
        onEvent({ type: "message.delta", delta: "Hello" });
        onEvent({ type: "message.delta", delta: " world" });
        onEvent({ type: "message.replaced", text: "Hey world" });
        onEvent({ type: "message.completed", text: "Hey world" });
        return { text: "Hey world" };
      },
    });
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Stream back to me" },
    });

    const sessionCookie = extractCookie(createResponse.headers["set-cookie"], "pixelclaw_session");
    const { threadId, runId } = createResponse.json();

    const streamResponse = await app.inject({
      method: "GET",
      url: `/api/chat/runs/${runId}/stream`,
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers["content-type"]).toContain("text/event-stream");
    expect(streamResponse.body).toContain("event: run.started");
    expect(streamResponse.body).toContain('data: {"delta":"Hello"}');
    expect(streamResponse.body).toContain('data: {"delta":" world"}');
    expect(streamResponse.body).toContain('event: message.replaced');
    expect(streamResponse.body).toContain('data: {"text":"Hey world"}');

    const transcript = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${threadId}/messages`,
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    expect(transcript.json()).toMatchObject({
      threadId,
      messages: [
        { role: "user", content: "Stream back to me", status: "completed" },
        { role: "assistant", content: "Hey world", status: "completed" },
      ],
    });
  });

  it("compacts into a new session and rotates the browser cookie when the engine requests handoff", async () => {
    const app = await buildServer({
      agentRunner: async ({ messages, onEvent }) => {
        expect(messages).toMatchObject([
          { role: "assistant", content: "Checkpoint summary" },
          { role: "user", content: "Recent user" },
          { role: "assistant", content: "Recent assistant" },
          { role: "user", content: "Trigger compaction" },
        ]);
        await onEvent({ type: "run.started" });
        await onEvent({ type: "message.completed", text: "Compacted response" });
        return { text: "Compacted response" };
      },
      compactionEngine: {
        prepareConversation: async ({ repository, session, pendingUserMessage: _pendingUserMessage }) => {
          const nextSession = await repository.createSession();
          const nextThread = await repository.createThread(nextSession.id);
          const summaryMessage = await repository.createMessage({
            threadId: nextThread.id,
            role: "assistant",
            content: "Checkpoint summary",
            status: "completed",
          });
          await repository.createMessage({
            threadId: nextThread.id,
            role: "user",
            content: "Recent user",
            status: "completed",
          });
          await repository.createMessage({
            threadId: nextThread.id,
            role: "assistant",
            content: "Recent assistant",
            status: "completed",
          });

          const methods = repository as unknown as {
            createSessionHandoff?: (input: {
              fromSessionId: string;
              toSessionId: string;
              summaryMessageId: string;
            }) => Promise<void>;
          };
          await methods.createSessionHandoff?.({
            fromSessionId: session.id,
            toSessionId: nextSession.id,
            summaryMessageId: summaryMessage.id,
          });

          return {
            session: nextSession,
            thread: nextThread,
            compacted: true,
          };
        },
      },
    });
    apps.push(app);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Warm up" },
    });
    const originalCookie = extractCookie(firstResponse.headers["set-cookie"], "pixelclaw_session");

    const compactedResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Trigger compaction" },
      headers: {
        cookie: `pixelclaw_session=${originalCookie}`,
      },
    });

    expect(compactedResponse.statusCode).toBe(201);
    const rotatedCookie = extractCookie(compactedResponse.headers["set-cookie"], "pixelclaw_session");
    expect(rotatedCookie).toBeTruthy();
    expect(rotatedCookie).not.toBe(originalCookie);

    const compactedPayload = compactedResponse.json();
    const transcript = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${compactedPayload.threadId}/messages`,
      headers: {
        cookie: `pixelclaw_session=${rotatedCookie}`,
      },
    });

    expect(transcript.json()).toMatchObject({
      messages: [
        { role: "assistant", content: "Checkpoint summary", status: "completed" },
        { role: "user", content: "Recent user", status: "completed" },
        { role: "assistant", content: "Recent assistant", status: "completed" },
        { role: "user", content: "Trigger compaction", status: "completed" },
        { role: "assistant", content: "", status: "pending" },
      ],
    });
  });

  it("returns admin run detail with the persisted transcript and audit timeline", async () => {
    const app = await buildServer({
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "run.state.changed", state: "planning" });
        await onEvent({ type: "tool.started", toolName: "read", args: { path: "README.md" } });
        await onEvent({ type: "tool.completed", toolName: "read", args: { path: "README.md" }, isError: false });
        await onEvent({
          type: "todo.updated",
          todoDocument: {
            sessionId: "session-1",
            updatedAt: "2026-03-09T10:00:00.000Z",
            todos: [{ id: "todo-1", text: "Inspect README", status: "done", note: "Captured in audit trail" }],
          },
        });
        await onEvent({ type: "message.completed", text: "Observed current system state." });
        return { text: "Observed current system state." };
      },
    });
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Inspect the system" },
    });

    const sessionCookie = extractCookie(createResponse.headers["set-cookie"], "pixelclaw_session");
    const { runId, threadId } = createResponse.json();

    await app.inject({
      method: "GET",
      url: `/api/chat/runs/${runId}/stream`,
      headers: {
        cookie: `pixelclaw_session=${sessionCookie}`,
      },
    });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/admin/runs/${runId}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      run: {
        id: runId,
        threadId,
        status: "completed",
        source: "web",
      },
      messages: [
        { role: "user", content: "Inspect the system", status: "completed" },
        { role: "assistant", content: "Observed current system state.", status: "completed" },
      ],
    });

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/api/admin/runs/${runId}/events`,
    });

    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.json()).toMatchObject({
      events: [
        { type: "run.created", source: "web" },
        { type: "run.started", source: "web" },
        { type: "run.state.changed", source: "web" },
        { type: "tool.started", source: "web" },
        { type: "tool.completed", source: "web" },
        { type: "todo.updated", source: "web" },
        { type: "message.completed", source: "web" },
      ],
    });
    expect(eventsResponse.json().events[3]).toMatchObject({
      type: "tool.started",
      payload: {
        toolName: "read",
        args: { path: "README.md" },
      },
    });
  });

  it("returns admin overview and run list across all sessions", async () => {
    const app = await buildServer({
      agentRunner: async ({ messages, onEvent }) => {
        await onEvent({ type: "run.started" });
        const latestPrompt = messages.at(-1)?.content ?? "";

        if (latestPrompt === "Investigate failure") {
          await onEvent({ type: "run.failed", error: "Investigation failed" });
          return { text: "" };
        }

        await onEvent({ type: "message.completed", text: "Everything looks stable." });
        return { text: "Everything looks stable." };
      },
    });
    apps.push(app);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "System check" },
    });
    const firstCookie = extractCookie(firstResponse.headers["set-cookie"], "pixelclaw_session");
    const firstRunId = firstResponse.json().runId;

    await app.inject({
      method: "GET",
      url: `/api/chat/runs/${firstRunId}/stream`,
      headers: {
        cookie: `pixelclaw_session=${firstCookie}`,
      },
    });

    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { content: "Investigate failure" },
    });
    const secondCookie = extractCookie(secondResponse.headers["set-cookie"], "pixelclaw_session");
    const secondRunId = secondResponse.json().runId;

    await app.inject({
      method: "GET",
      url: `/api/chat/runs/${secondRunId}/stream`,
      headers: {
        cookie: `pixelclaw_session=${secondCookie}`,
      },
    });

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
    });

    expect(overviewResponse.statusCode).toBe(200);
    expect(overviewResponse.json()).toMatchObject({
      counts: {
        activeRuns: 0,
        failedRunsLast24Hours: 1,
        runsLast24Hours: 2,
        activeSessions: 0,
      },
    });

    const runsResponse = await app.inject({
      method: "GET",
      url: "/api/admin/runs",
    });

    expect(runsResponse.statusCode).toBe(200);
    expect(runsResponse.json()).toMatchObject({
      runs: [
        {
          id: secondRunId,
          status: "failed",
          source: "web",
          latestEventType: "run.failed",
          preview: "Investigation failed",
        },
        {
          id: firstRunId,
          status: "completed",
          source: "web",
          latestEventType: "message.completed",
          preview: "Everything looks stable.",
        },
      ],
    });
  });
});
