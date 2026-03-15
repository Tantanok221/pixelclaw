import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

describe("model-provider module layout", () => {
  it("exports the provider contract from the model-provider directory barrel", async () => {
    const module = await import("../src/model-provider/index.js");

    expect(module.BaseModelProvider).toBeTypeOf("function");
    expect(module.CodexModelProvider).toBeTypeOf("function");
    expect(module.OpenRouterModelProvider).toBeTypeOf("function");
    expect(module.defaultModelProvider).toBe(module.codexModelProvider);
  });

  it("exports the auth path resolver from the auth module", async () => {
    const module = await import("../src/model-provider/auth.js");

    expect(module.resolveProviderAuthFilePath).toBeTypeOf("function");
  });
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
});

describe("OpenRouterModelProvider", () => {
  it("uses the paraphrase model and reads OPENROUTER_API_KEY from the environment", async () => {
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";

    const { OpenRouterModelProvider } = await import("../src/ModelProvider.js");
    const provider = new OpenRouterModelProvider("deepseek/deepseek-v3.2");

    expect(provider.providerName).toBe("openrouter");
    expect(provider.modelName).toBe("deepseek/deepseek-v3.2");
    expect(provider.apiName).toBe("openai-completions");
    expect(provider.getModel()).toMatchObject({
      provider: "openrouter",
      id: "deepseek/deepseek-v3.2",
      api: "openai-completions",
    });
    await expect(provider.getApiKey()).resolves.toBe("openrouter-test-key");
  });
});
