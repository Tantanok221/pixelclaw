import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as serverIndex from "../src/index.js";
import { loadTelegramConfig } from "../src/telegramConfig.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.PIXELCLAW_HOME;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Telegram config resolution", () => {
  it("resolves telegram.json from the Pixelclaw system directory by default", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/pixel-home");

    const resolveTelegramConfigPath = (
      serverIndex as {
        resolveTelegramConfigPath?: () => Promise<string>;
      }
    ).resolveTelegramConfigPath;

    expect(resolveTelegramConfigPath).toBeTypeOf("function");
    await expect(resolveTelegramConfigPath?.()).resolves.toBe(
      path.join("/tmp/pixel-home", ".pixelclaw", "workspace", "system", "telegram.json"),
    );
  });

  it("loads the bot token from the Pixelclaw system directory", async () => {
    const tempHome = await createTempDir("pixelclaw-home-");
    const systemDir = path.join(tempHome, "system");

    process.env.PIXELCLAW_HOME = tempHome;
    await mkdir(systemDir, { recursive: true });
    await writeFile(
      path.join(systemDir, "telegram.json"),
      JSON.stringify({ botToken: "123:abc" }, null, 2),
      "utf-8",
    );

    await expect(loadTelegramConfig()).resolves.toEqual({
      botToken: "123:abc",
    });
  });

  it("returns null when telegram.json is missing", async () => {
    const tempHome = await createTempDir("pixelclaw-home-");

    process.env.PIXELCLAW_HOME = tempHome;

    await expect(loadTelegramConfig()).resolves.toBeNull();
  });
});
