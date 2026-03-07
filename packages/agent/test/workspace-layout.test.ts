import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

describe("workspace layout", () => {
  it("configures the repository as a turborepo with a packages/agent workspace", async () => {
    const rootPackageJson = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf-8"),
    ) as {
      private?: boolean;
      workspaces?: string[];
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(rootPackageJson.private).toBe(true);
    expect(rootPackageJson.workspaces).toContain("packages/*");
    expect(rootPackageJson.scripts).toMatchObject({
      build: "turbo run build",
      test: "turbo run test",
      dev: "turbo run dev --filter=agent",
    });
    expect(rootPackageJson.devDependencies?.turbo).toBeTypeOf("string");

    await expect(access(path.join(repoRoot, "turbo.json"))).resolves.toBeUndefined();
    await expect(
      access(path.join(repoRoot, "packages", "agent", "package.json")),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(repoRoot, "packages", "agent", "src", "index.ts")),
    ).resolves.toBeUndefined();
  });
});
