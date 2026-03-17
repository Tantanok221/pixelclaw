import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { ChatRepository } from "../src/repository.js";

type PollerModule = {
  pollGithubMonitor?: (options: {
    githubCredentialSource: {
      getAccessToken: (input: { hostname: string; login: string }) => Promise<string>;
    };
    githubClient: {
      listMonitoredPullRequests: (input: {
        accessToken: string;
        owner: string;
        repo: string;
        authorLogin: string;
      }) => Promise<
        Array<{
          number: number;
          title: string;
          url: string;
          headSha: string;
          mergeableState: string | null;
          checksState: "passing" | "failing" | "pending";
          latestExternalComment: null | {
            id: string;
            authorLogin: string;
            body: string;
            url: string;
            createdAt: string;
          };
        }>
      >;
    };
    repository: ChatRepository;
    monitorId: string;
  }) => Promise<void>;
};

describe("GitHub monitor poller", () => {
  it("seeds snapshots on first poll without creating notifications, then emits comment/check/conflict notifications on changes", async () => {
    const database = createDatabase();
    const repository = new ChatRepository(database.daos);
    const account = await repository.createGithubAccount({
      providerUserId: "12345",
      hostname: "github.com",
      login: "tantanok",
      displayName: "Tan Tanok",
      avatarUrl: null,
      scopes: ["repo"],
      tokenSource: "keyring",
    });
    const monitor = await repository.createMonitor({
      githubAccountId: account.id,
      owner: "pixelclaw",
      repo: "web",
      name: "My web PRs",
    });

    const module = ((await import("../src/githubMonitorPoller.js").catch(() => ({}))) as PollerModule);
    expect(module.pollGithubMonitor).toBeTypeOf("function");

    const sequence = [
      [
        {
          number: 42,
          title: "Fix alert strip",
          url: "https://github.com/pixelclaw/web/pull/42",
          headSha: "sha-1",
          mergeableState: "clean",
          checksState: "passing" as const,
          latestExternalComment: null,
        },
      ],
      [
        {
          number: 42,
          title: "Fix alert strip",
          url: "https://github.com/pixelclaw/web/pull/42",
          headSha: "sha-2",
          mergeableState: "dirty",
          checksState: "failing" as const,
          latestExternalComment: {
            id: "comment-7",
            authorLogin: "reviewer",
            body: "Please rebase this branch",
            url: "https://github.com/pixelclaw/web/pull/42#discussion_r7",
            createdAt: "2026-03-09T14:00:00.000Z",
          },
        },
      ],
    ];
    let index = 0;
    const githubCredentialSource = {
      async getAccessToken(input: { hostname: string; login: string }) {
        expect(input).toEqual({
          hostname: "github.com",
          login: "tantanok",
        });
        return "ghu_test_token";
      },
    };
    const githubClient = {
      async listMonitoredPullRequests(input: { accessToken: string }) {
        expect(input.accessToken).toBe("ghu_test_token");
        const result = sequence[index] ?? sequence.at(-1) ?? [];
        index += 1;
        return result;
      },
    };

    await module.pollGithubMonitor?.({
      githubCredentialSource,
      githubClient,
      repository,
      monitorId: monitor!.id,
    });

    expect(await repository.listMonitorNotifications()).toEqual([]);

    await module.pollGithubMonitor?.({
      githubCredentialSource,
      githubClient,
      repository,
      monitorId: monitor!.id,
    });

    const notifications = await repository.listMonitorNotifications();
    expect(notifications.map((item) => item.eventType).sort()).toEqual([
      "checks.failed",
      "comment.created",
      "merge_conflict.detected",
    ]);

    database.sqlite.close();
  });
});
