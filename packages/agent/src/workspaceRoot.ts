import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function findWorkspaceRoot(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (await isWorkspaceRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }

    currentDir = parentDir;
  }
}

export function resolveAgentWorkspaceRoot() {
  return process.env.PIXELCLAW_HOME
    ? path.resolve(process.env.PIXELCLAW_HOME)
    : path.join(os.homedir(), ".pixelclaw");
}

export async function ensureAgentWorkspaceRoot() {
  const workspaceRoot = resolveAgentWorkspaceRoot();
  await mkdir(workspaceRoot, { recursive: true });
  return workspaceRoot;
}

export function resolveAgentSystemRoot() {
  return path.join(resolveAgentWorkspaceRoot(), "system");
}

export async function ensureAgentSystemRoot() {
  const systemRoot = resolveAgentSystemRoot();
  await mkdir(systemRoot, { recursive: true });
  return systemRoot;
}

async function isWorkspaceRoot(candidateDir: string): Promise<boolean> {
  try {
    await access(path.join(candidateDir, "turbo.json"));
  } catch {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      await readFile(path.join(candidateDir, "package.json"), "utf-8"),
    ) as { workspaces?: string[] };

    return Array.isArray(packageJson.workspaces);
  } catch {
    return false;
  }
}
