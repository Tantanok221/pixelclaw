import { readFile } from "node:fs/promises";
import path from "node:path";
import { ensureAgentSystemRoot } from "../../agent/src/workspaceRoot.js";

export interface TelegramConfig {
  botToken: string;
}

export async function resolveTelegramConfigPath() {
  const systemRoot = await ensureAgentSystemRoot();
  return path.join(systemRoot, "telegram.json");
}

export async function loadTelegramConfig(): Promise<TelegramConfig | null> {
  const configPath = await resolveTelegramConfigPath();

  try {
    const rawConfig = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(rawConfig) as { botToken?: unknown };

    if (typeof parsed.botToken !== "string" || parsed.botToken.trim() === "") {
      return null;
    }

    return {
      botToken: parsed.botToken.trim(),
    };
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return null;
    }

    console.error("Failed to load Telegram config", error);
    return null;
  }
}
