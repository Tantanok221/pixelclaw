import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

describe("monitor configuration APIs", () => {
  const apps: Array<{ close: () => Promise<unknown> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("syncs and lists connected GitHub accounts from gh", async () => {
    const githubCredentialSource = {
      listAccounts: async () => [
        {
          hostname: "github.com",
          login: "tantanok",
          scopes: ["read:org", "repo"],
          tokenSource: "keyring",
        },
      ],
      getAccessToken: async () => "ghu_example",
    };
    const githubClient = {
      getViewer: async () => ({
        id: 12345,
        login: "tantanok",
        name: "Tan Tanok",
        avatarUrl: "https://avatars.example/tantanok.png",
      }),
    };
    const app = await buildServer({
      telegramBotStarter: async () => null,
      githubCredentialSource,
      githubClient: githubClient as never,
    });
    apps.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/monitor/github/accounts/sync",
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      accounts: [
        expect.objectContaining({
          providerUserId: "12345",
          hostname: "github.com",
          login: "tantanok",
          displayName: "Tan Tanok",
          avatarUrl: "https://avatars.example/tantanok.png",
          scopes: ["read:org", "repo"],
          tokenSource: "keyring",
        }),
      ],
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/monitor/github/accounts",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      accounts: [
        expect.objectContaining({
          providerUserId: "12345",
          hostname: "github.com",
          login: "tantanok",
          displayName: "Tan Tanok",
          avatarUrl: "https://avatars.example/tantanok.png",
          scopes: ["read:org", "repo"],
          tokenSource: "keyring",
        }),
      ],
    });
  });

  it("creates and lists monitors bound to a GitHub account", async () => {
    const githubCredentialSource = {
      listAccounts: async () => [
        {
          hostname: "github.com",
          login: "tantanok",
          scopes: ["read:org", "repo"],
          tokenSource: "keyring",
        },
      ],
      getAccessToken: async () => "ghu_example",
    };
    const githubClient = {
      getViewer: async () => ({
        id: 12345,
        login: "tantanok",
        name: "Tan Tanok",
        avatarUrl: null,
      }),
      listRepositories: async () => [
        {
          owner: "pixelclaw",
          name: "web",
          fullName: "pixelclaw/web",
        },
        {
          owner: "pixelclaw",
          name: "server",
          fullName: "pixelclaw/server",
        },
      ],
    };
    const app = await buildServer({
      telegramBotStarter: async () => null,
      githubCredentialSource,
      githubClient: githubClient as never,
    });
    apps.push(app);

    const accountResponse = await app.inject({
      method: "POST",
      url: "/api/monitor/github/accounts/sync",
    });
    const accountId = accountResponse.json().accounts[0].id as string;

    const repositoriesResponse = await app.inject({
      method: "GET",
      url: `/api/monitor/github/accounts/${accountId}/repositories`,
    });

    expect(repositoriesResponse.statusCode).toBe(200);
    expect(repositoriesResponse.json()).toEqual({
      repositories: [
        {
          owner: "pixelclaw",
          name: "server",
          fullName: "pixelclaw/server",
        },
        {
          owner: "pixelclaw",
          name: "web",
          fullName: "pixelclaw/web",
        },
      ],
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/monitors",
      payload: {
        githubAccountId: accountId,
        repository: "pixelclaw/web",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      monitor: {
        githubAccountId: accountId,
        provider: "github",
        owner: "pixelclaw",
        repo: "web",
        name: "web PRs",
        status: "active",
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/monitors",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      monitors: [
        expect.objectContaining({
          githubAccountId: accountId,
          provider: "github",
          owner: "pixelclaw",
          repo: "web",
          name: "web PRs",
          status: "active",
        }),
      ],
    });
  });

  it("rejects monitor creation when the referenced GitHub account does not exist", async () => {
    const app = await buildServer({
      telegramBotStarter: async () => null,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/monitors",
      payload: {
        githubAccountId: "missing-account",
        repository: "pixelclaw/web",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "GitHub account not found",
    });
  });
});
