import { access, readFile } from "node:fs/promises";
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
