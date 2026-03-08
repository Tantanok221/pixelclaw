import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../server/src/database.js";
import { ChatRepository } from "../../server/src/repository.js";
import { runTelegramPairingCli } from "../src/index.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Telegram pairing CLI", () => {
  it("authorizes a pending Telegram pairing code against the shared database", async () => {
    const tempDir = await createTempDir("pixelclaw-telegram-pairing-");
    const databasePath = path.join(tempDir, "pixelclaw.sqlite");
    const database = createDatabase(databasePath);
    const repository = new ChatRepository(database.db);
    await repository.saveTelegramPairingCode("7001", "PAIR-CLI", "2030-01-01T00:10:00.000Z");
    database.sqlite.close();

    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runTelegramPairingCli(["PAIR-CLI"], {
      databasePath,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Telegram user 7001 paired");

    const verificationDatabase = createDatabase(databasePath);
    const verificationRepository = new ChatRepository(verificationDatabase.db);
    await expect(verificationRepository.getTelegramUserAccess("7001")).resolves.toMatchObject({
      isAuthorized: 1,
    });
    verificationDatabase.sqlite.close();
  });
});
