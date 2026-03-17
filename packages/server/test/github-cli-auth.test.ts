import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

describe("GitHub CLI account sync", () => {
  const apps: Array<{ close: () => Promise<unknown> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("syncs authenticated gh accounts into monitor configuration", async () => {
    const githubCredentialSource = {
      listAccounts: async () => [
        {
          hostname: "github.com",
          login: "tantanok",
          scopes: ["read:org", "repo"],
          tokenSource: "keyring",
        },
      ],
      getAccessToken: async () => "ghu_test_token",
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

    const response = await app.inject({
      method: "POST",
      url: "/api/monitor/github/accounts/sync",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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
});
