import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findWorkspaceRoot } from "../src/workspaceRoot.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true })),
    ),
  );
});

describe("findWorkspaceRoot", () => {
  it("walks up to the turborepo root when started from a workspace package", async () => {
    const repoRoot = await createTempDir("pixelclaw-workspace-root-");
    const packageDir = path.join(repoRoot, "packages", "agent");

    await mkdir(path.join(packageDir, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "turbo.json"), "{}\n", "utf-8");
    await writeFile(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
      "utf-8",
    );

    expect(await findWorkspaceRoot(packageDir)).toBe(repoRoot);
  });
});
