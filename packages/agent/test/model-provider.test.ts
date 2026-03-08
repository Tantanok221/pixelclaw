import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAuthFilePath } from "../src/ModelProvider.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.PIXELCLAW_HOME;
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveAuthFilePath", () => {
  it("resolves auth.json from the Pixelclaw system directory", async () => {
    const workspaceRoot = await createTempDir("pixelclaw-workspace-");
    const packageDir = path.join(workspaceRoot, "packages", "server");
    const homeDir = await createTempDir("pixelclaw-home-");

    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }, null, 2),
      "utf-8",
    );
    await writeFile(path.join(workspaceRoot, "turbo.json"), JSON.stringify({}, null, 2), "utf-8");
    vi.spyOn(os, "homedir").mockReturnValue(homeDir);

    await expect(resolveAuthFilePath(packageDir)).resolves.toBe(
      path.join(homeDir, ".pixelclaw", "system", "auth.json"),
    );
  });

  it("moves a legacy auth file from the workspace root into the system directory", async () => {
    const workspaceRoot = await createTempDir("pixelclaw-workspace-");
    const packageDir = path.join(workspaceRoot, "packages", "server");
    const homeDir = await createTempDir("pixelclaw-home-");
    const legacyAuthPath = path.join(workspaceRoot, "auth.json");
    const systemAuthPath = path.join(homeDir, ".pixelclaw", "system", "auth.json");

    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }, null, 2),
      "utf-8",
    );
    await writeFile(path.join(workspaceRoot, "turbo.json"), JSON.stringify({}, null, 2), "utf-8");
    await writeFile(legacyAuthPath, JSON.stringify({ legacy: true }), "utf-8");

    vi.spyOn(os, "homedir").mockReturnValue(homeDir);

    await expect(resolveAuthFilePath(packageDir)).resolves.toBe(systemAuthPath);
    await expect(access(systemAuthPath)).resolves.toBeUndefined();
    await expect(access(legacyAuthPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not read a legacy auth file from the old workspace system directory", async () => {
    const workspaceRoot = await createTempDir("pixelclaw-workspace-");
    const packageDir = path.join(workspaceRoot, "packages", "server");
    const homeDir = await createTempDir("pixelclaw-home-");
    const legacySystemAuthPath = path.join(
      homeDir,
      ".pixelclaw",
      "workspace",
      "system",
      "auth.json",
    );
    const systemAuthPath = path.join(homeDir, ".pixelclaw", "system", "auth.json");

    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }, null, 2),
      "utf-8",
    );
    await writeFile(path.join(workspaceRoot, "turbo.json"), JSON.stringify({}, null, 2), "utf-8");
    await mkdir(path.dirname(legacySystemAuthPath), { recursive: true });
    await writeFile(legacySystemAuthPath, JSON.stringify({ legacy: true }), "utf-8");

    vi.spyOn(os, "homedir").mockReturnValue(homeDir);

    await expect(resolveAuthFilePath(packageDir)).resolves.toBe(systemAuthPath);
    await expect(access(systemAuthPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(legacySystemAuthPath)).resolves.toBeUndefined();
  });
});
