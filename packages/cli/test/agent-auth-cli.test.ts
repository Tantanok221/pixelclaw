import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loginOpenAICodex } = vi.hoisted(() => ({
  loginOpenAICodex: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai/oauth", () => ({
  loginOpenAICodex,
}));

import { runAgentAuthCli } from "../src/auth.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.PIXELCLAW_HOME;
  vi.restoreAllMocks();
  loginOpenAICodex.mockReset();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("agent auth CLI", () => {
  beforeEach(() => {
    loginOpenAICodex.mockResolvedValue({
      access: "access-token",
      refresh: "refresh-token",
      expires: "2030-01-01T00:00:00.000Z",
      accountId: "acct_123",
    });
  });

  it("stores OpenAI Codex OAuth credentials in the Pixelclaw system auth file", async () => {
    const homeDir = await createTempDir("pixelclaw-home-");
    process.env.PIXELCLAW_HOME = homeDir;

    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runAgentAuthCli([], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(loginOpenAICodex).toHaveBeenCalledTimes(1);

    const authPath = path.join(homeDir, "system", "auth.json");
    const auth = JSON.parse(await readFile(authPath, "utf-8")) as Record<string, unknown>;

    expect(auth).toMatchObject({
      "openai-codex": {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expires: "2030-01-01T00:00:00.000Z",
        accountId: "acct_123",
      },
    });
    expect(stdout.join("\n")).toContain(authPath);
  });

  it("preserves existing auth entries when saving the OpenAI Codex credentials", async () => {
    const homeDir = await createTempDir("pixelclaw-home-");
    process.env.PIXELCLAW_HOME = homeDir;
    const systemDir = path.join(homeDir, "system");

    await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
      await mkdir(systemDir, { recursive: true });
      await writeFile(
        path.join(systemDir, "auth.json"),
        JSON.stringify(
          {
            "github-copilot": {
              type: "oauth",
              access: "copilot-token",
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
    });

    const exitCode = await runAgentAuthCli([], {
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);

    const auth = JSON.parse(
      await readFile(path.join(systemDir, "auth.json"), "utf-8"),
    ) as Record<string, unknown>;

    expect(auth).toMatchObject({
      "github-copilot": {
        type: "oauth",
        access: "copilot-token",
      },
      "openai-codex": {
        type: "oauth",
        access: "access-token",
      },
    });
  });
});
