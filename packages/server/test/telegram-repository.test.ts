import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { ChatRepository } from "../src/repository.js";

describe("Telegram chat persistence", () => {
  it("creates the telegram_chats table", () => {
    const database = createDatabase();
    const row = database.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'telegram_chats'",
      )
      .get() as { name?: string } | undefined;

    expect(row?.name).toBe("telegram_chats");
    database.sqlite.close();
  });

  it("stores and rotates the mapped session for a Telegram chat", async () => {
    const database = createDatabase();
    const repository = new ChatRepository(database.db);
    const methods = repository as unknown as {
      setTelegramChatSession?: (chatId: string, sessionId: string) => Promise<void>;
      getTelegramChatSession?: (chatId: string) => Promise<{ chatId: string; sessionId: string } | undefined>;
    };

    expect(methods.setTelegramChatSession).toBeTypeOf("function");
    expect(methods.getTelegramChatSession).toBeTypeOf("function");

    const firstSession = await repository.createSession("00000000-0000-4000-8000-000000000001");
    const secondSession = await repository.createSession("00000000-0000-4000-8000-000000000002");

    await methods.setTelegramChatSession?.("1234", firstSession.id);
    await expect(methods.getTelegramChatSession?.("1234")).resolves.toMatchObject({
      chatId: "1234",
      sessionId: firstSession.id,
    });

    await methods.setTelegramChatSession?.("1234", secondSession.id);
    await expect(methods.getTelegramChatSession?.("1234")).resolves.toMatchObject({
      chatId: "1234",
      sessionId: secondSession.id,
    });

    database.sqlite.close();
  });
});
