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
    const repository = new ChatRepository(database.daos);
    const methods = repository as unknown as {
      setTelegramChatSession?: (chatId: string, sessionId: string) => Promise<void>;
      getTelegramChatSession?: (
        chatId: string,
      ) => Promise<
        | {
            chatId: string;
            sessionId: string;
            mode: string;
          }
        | undefined
      >;
      setTelegramChatMode?: (chatId: string, mode: "chat" | "work") => Promise<void>;
    };

    expect(methods.setTelegramChatSession).toBeTypeOf("function");
    expect(methods.getTelegramChatSession).toBeTypeOf("function");
    expect(methods.setTelegramChatMode).toBeTypeOf("function");

    const firstSession = await repository.createSession("00000000-0000-4000-8000-000000000001");
    const secondSession = await repository.createSession("00000000-0000-4000-8000-000000000002");

    await methods.setTelegramChatSession?.("1234", firstSession.id);
    await expect(methods.getTelegramChatSession?.("1234")).resolves.toMatchObject({
      chatId: "1234",
      sessionId: firstSession.id,
      mode: "work",
    });

    await methods.setTelegramChatMode?.("1234", "chat");
    await methods.setTelegramChatSession?.("1234", secondSession.id);
    await expect(methods.getTelegramChatSession?.("1234")).resolves.toMatchObject({
      chatId: "1234",
      sessionId: secondSession.id,
      mode: "chat",
    });

    database.sqlite.close();
  });

  it("stores pending Telegram pairing codes and authorizes users globally", async () => {
    const database = createDatabase();
    const repository = new ChatRepository(database.daos);
    const methods = repository as unknown as {
      getTelegramUserAccess?: (
        userId: string,
      ) => Promise<
        | {
            userId: string;
            isAuthorized: number;
            pairingCode: string | null;
            pairingCodeExpiresAt: string | null;
            pairedAt: string | null;
          }
        | undefined
      >;
      saveTelegramPairingCode?: (
        userId: string,
        pairingCode: string,
        pairingCodeExpiresAt: string,
      ) => Promise<void>;
      authorizeTelegramUserByPairingCode?: (
        pairingCode: string,
      ) => Promise<
        | {
            userId: string;
            isAuthorized: number;
            pairingCode: string | null;
            pairingCodeExpiresAt: string | null;
            pairedAt: string | null;
          }
        | null
      >;
    };

    expect(methods.getTelegramUserAccess).toBeTypeOf("function");
    expect(methods.saveTelegramPairingCode).toBeTypeOf("function");
    expect(methods.authorizeTelegramUserByPairingCode).toBeTypeOf("function");

    const expiresAt = "2030-01-01T00:10:00.000Z";
    await methods.saveTelegramPairingCode?.("user-42", "PAIR-1234", expiresAt);

    await expect(methods.getTelegramUserAccess?.("user-42")).resolves.toMatchObject({
      userId: "user-42",
      isAuthorized: 0,
      pairingCode: "PAIR-1234",
      pairingCodeExpiresAt: expiresAt,
      pairedAt: null,
    });

    await expect(methods.authorizeTelegramUserByPairingCode?.("PAIR-1234")).resolves.toMatchObject(
      {
        userId: "user-42",
        isAuthorized: 1,
        pairingCode: null,
        pairingCodeExpiresAt: null,
      },
    );

    await expect(methods.getTelegramUserAccess?.("user-42")).resolves.toMatchObject({
      userId: "user-42",
      isAuthorized: 1,
      pairingCode: null,
      pairingCodeExpiresAt: null,
    });

    database.sqlite.close();
  });
});
