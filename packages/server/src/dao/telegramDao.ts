import { eq } from "drizzle-orm";
import {
  telegramChats,
  telegramUsers,
  type TelegramChatRow,
  type TelegramUserRow,
} from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class TelegramChatsDao {
  constructor(private readonly db: DatabaseClient) {}

  async findByChatId(chatId: string): Promise<TelegramChatRow | undefined> {
    return this.db.query.telegramChats.findFirst({
      where: eq(telegramChats.chatId, chatId),
    });
  }

  async insert(values: TelegramChatRow): Promise<void> {
    await this.db.insert(telegramChats).values(values);
  }

  async updateByChatId(
    chatId: string,
    patch: Partial<Pick<TelegramChatRow, "sessionId" | "lastUpdateId" | "updatedAt">>,
  ): Promise<void> {
    await this.db.update(telegramChats).set(patch).where(eq(telegramChats.chatId, chatId));
  }
}

export class TelegramUsersDao {
  constructor(private readonly db: DatabaseClient) {}

  async findByUserId(userId: string): Promise<TelegramUserRow | undefined> {
    return this.db.query.telegramUsers.findFirst({
      where: eq(telegramUsers.userId, userId),
    });
  }

  async findByPairingCode(pairingCode: string): Promise<TelegramUserRow | undefined> {
    return this.db.query.telegramUsers.findFirst({
      where: eq(telegramUsers.pairingCode, pairingCode),
    });
  }

  async insert(values: TelegramUserRow): Promise<void> {
    await this.db.insert(telegramUsers).values(values);
  }

  async updateByUserId(
    userId: string,
    patch: Partial<
      Pick<TelegramUserRow, "isAuthorized" | "pairingCode" | "pairingCodeExpiresAt" | "pairedAt" | "updatedAt">
    >,
  ): Promise<void> {
    await this.db.update(telegramUsers).set(patch).where(eq(telegramUsers.userId, userId));
  }
}
