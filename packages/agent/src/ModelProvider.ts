import { getModel } from "@mariozechner/pi-ai";
import { readFileSync, writeFileSync } from "node:fs";
import { access, copyFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import {
  ensureAgentSystemRoot,
  ensureAgentWorkspaceRoot,
  findWorkspaceRoot,
} from "./workspaceRoot.js";

const PROVIDER_NAME = "openai-codex";
const MODEL_NAME = "gpt-5.4";

export function getConfiguredModel() {
  return getModel(PROVIDER_NAME, MODEL_NAME);
}

export async function getProviderApiKey(startDir = process.cwd()) {
  const authFilePath = await resolveAuthFilePath(startDir);
  const auth = JSON.parse(readFileSync(authFilePath, "utf-8"));
  const result = await getOAuthApiKey(PROVIDER_NAME, auth);

  if (!result) {
    throw new Error("Not logged in");
  }

  auth[PROVIDER_NAME] = { type: "oauth", ...result.newCredentials };
  writeFileSync(authFilePath, JSON.stringify(auth, null, 2));

  return result.apiKey;
}

export async function resolveAuthFilePath(startDir = process.cwd()) {
  const agentSystemRoot = await ensureAgentSystemRoot();
  const authFilePath = path.join(agentSystemRoot, "auth.json");

  await migrateLegacyAuthFile(startDir, authFilePath);

  return authFilePath;
}

async function migrateLegacyAuthFile(startDir: string, authFilePath: string) {
  if (await pathExists(authFilePath)) {
    return;
  }

  const agentWorkspaceRoot = await ensureAgentWorkspaceRoot();
  const legacyHomeAuthFilePath = path.join(agentWorkspaceRoot, "auth.json");
  const workspaceRoot = await findWorkspaceRoot(startDir);
  const legacyAuthFilePath = path.join(workspaceRoot, "auth.json");

  for (const candidatePath of [legacyHomeAuthFilePath, legacyAuthFilePath]) {
    if (candidatePath === authFilePath) {
      continue;
    }

    if (await pathExists(candidatePath)) {
      await moveFile(candidatePath, authFilePath);
      return;
    }
  }
}

async function pathExists(candidatePath: string) {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function moveFile(sourcePath: string, targetPath: string) {
  try {
    await rename(sourcePath, targetPath);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

    if (code !== "EXDEV") {
      throw error;
    }

    await copyFile(sourcePath, targetPath);
    await unlink(sourcePath);
  }
}
