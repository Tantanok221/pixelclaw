import { access, copyFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { ensureAgentSystemRoot, ensureAgentWorkspaceRoot } from "../../agent/src/workspaceRoot.js";
import { buildServer } from "./app.js";
import { resolveTelegramConfigPath as resolveTelegramConfigPathFromFile } from "./telegramConfig.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

async function main() {
  const databasePath = await resolveDatabasePath();
  const app = await buildServer({ databasePath });
  await app.listen({ port, host });
  console.log(`Pixelclaw server listening on http://${host}:${port}`);
}

export async function resolveDatabasePath() {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }

  const systemRoot = await ensureAgentSystemRoot();
  const databasePath = path.join(systemRoot, "pixelclaw.sqlite");

  await migrateLegacyDatabasePath(databasePath);

  return databasePath;
}

export async function resolveTelegramConfigPath() {
  return resolveTelegramConfigPathFromFile();
}

async function migrateLegacyDatabasePath(databasePath: string) {
  if (await pathExists(databasePath)) {
    return;
  }

  const workspaceRoot = await ensureAgentWorkspaceRoot();
  const legacyCandidates = [
    path.join(workspaceRoot, "pixelclaw.sqlite"),
    path.join(process.cwd(), "pixelclaw.sqlite"),
  ];

  for (const candidatePath of legacyCandidates) {
    if (candidatePath === databasePath) {
      continue;
    }

    if (await pathExists(candidatePath)) {
      await moveFile(candidatePath, databasePath);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
