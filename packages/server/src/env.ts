import { access } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { findWorkspaceRoot } from "../../agent/src/workspaceRoot.js";

export async function loadServerEnv(startDir = process.cwd()): Promise<string | null> {
  const workspaceRoot = await findWorkspaceRoot(startDir);
  const candidatePaths = Array.from(
    new Set([path.join(workspaceRoot, ".env"), path.join(path.resolve(startDir), ".env")]),
  );

  for (const candidatePath of candidatePaths) {
    if (!(await pathExists(candidatePath))) {
      continue;
    }

    config({ path: candidatePath });
    return candidatePath;
  }

  return null;
}

async function pathExists(candidatePath: string) {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}
