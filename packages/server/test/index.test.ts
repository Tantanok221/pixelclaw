import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "../src/env.js";
import { resolveDatabasePath } from "../src/index.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.DATABASE_PATH;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.PIXELCLAW_HOME;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadServerEnv", () => {
  it("loads workspace root .env values when the server starts from a package directory", async () => {
    const workspaceRoot = await createTempDir("pixelclaw-workspace-");
    const serverDir = path.join(workspaceRoot, "packages", "server");
    delete process.env.OPENROUTER_API_KEY;

    await mkdir(serverDir, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }, null, 2),
      "utf-8",
    );
    await writeFile(path.join(workspaceRoot, "turbo.json"), JSON.stringify({}, null, 2), "utf-8");
    await writeFile(
      path.join(workspaceRoot, ".env"),
      "OPENROUTER_API_KEY=from-workspace-env\n",
      "utf-8",
    );

    const loadedEnvPath = await loadServerEnv(serverDir);

    expect(loadedEnvPath).toBe(path.join(workspaceRoot, ".env"));
    expect(process.env.OPENROUTER_API_KEY).toBe("from-workspace-env");
  });
});

describe("resolveDatabasePath", () => {
  it("uses the Pixelclaw system directory by default", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/pixel-home");

    await expect(resolveDatabasePath()).resolves.toBe(
      path.join("/tmp/pixel-home", ".pixelclaw", "system", "pixelclaw.sqlite"),
    );
  });

  it("prefers DATABASE_PATH when provided", async () => {
    process.env.DATABASE_PATH = "/tmp/custom.sqlite";

    await expect(resolveDatabasePath()).resolves.toBe("/tmp/custom.sqlite");
  });

  it("does not read a legacy database from the old workspace system directory", async () => {
    const homeDir = await createTempDir("pixelclaw-home-");
    const legacyDatabasePath = path.join(
      homeDir,
      ".pixelclaw",
      "workspace",
      "system",
      "pixelclaw.sqlite",
    );
    const databasePath = path.join(homeDir, ".pixelclaw", "system", "pixelclaw.sqlite");

    vi.spyOn(os, "homedir").mockReturnValue(homeDir);
    await mkdir(path.dirname(legacyDatabasePath), { recursive: true });
    await writeFile(legacyDatabasePath, "legacy", "utf-8");

    await expect(resolveDatabasePath()).resolves.toBe(databasePath);
    await expect(access(databasePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(legacyDatabasePath)).resolves.toBeUndefined();
  });
});
