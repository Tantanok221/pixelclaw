import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema.js";
import {
  messages,
  runs,
  sessionHandoffs,
  sessions,
  telegramChats,
  threads,
  type MessageRow,
  type RunRow,
  type SessionHandoffRow,
  type SessionRow,
  type TelegramChatRow,
  telegramUsers,
  type TelegramUserRow,
  type ThreadRow,
} from "./schema.js";

export class ChatRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  async createSession(id = randomUUID()): Promise<SessionRow> {
    const now = nowIso();
    await this.db.insert(sessions).values({
      id,
      createdAt: now,
      updatedAt: now,
      lastThreadId: null,
    });
    return this.getRequiredSession(id);
  }

  async getSession(id: string): Promise<SessionRow | undefined> {
    return this.db.query.sessions.findFirst({
      where: eq(sessions.id, id),
    });
  }

  async getTelegramChatSession(chatId: string): Promise<TelegramChatRow | undefined> {
    return this.db.query.telegramChats.findFirst({
      where: eq(telegramChats.chatId, chatId),
    });
  }

  async setTelegramChatSession(chatId: string, sessionId: string): Promise<void> {
    const now = nowIso();
    const existing = await this.getTelegramChatSession(chatId);

    if (existing) {
      await this.db
        .update(telegramChats)
        .set({
          sessionId,
          updatedAt: now,
        })
        .where(eq(telegramChats.chatId, chatId));
      return;
    }

    await this.db.insert(telegramChats).values({
      chatId,
      sessionId,
      lastUpdateId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async getTelegramUserAccess(userId: string): Promise<TelegramUserRow | undefined> {
    return this.db.query.telegramUsers.findFirst({
      where: eq(telegramUsers.userId, userId),
    });
  }

  async saveTelegramPairingCode(
    userId: string,
    pairingCode: string,
    pairingCodeExpiresAt: string,
  ): Promise<void> {
    const now = nowIso();
    const existing = await this.getTelegramUserAccess(userId);

    if (existing) {
      await this.db
        .update(telegramUsers)
        .set({
          isAuthorized: 0,
          pairingCode,
          pairingCodeExpiresAt,
          pairedAt: null,
          updatedAt: now,
        })
        .where(eq(telegramUsers.userId, userId));
      return;
    }

    await this.db.insert(telegramUsers).values({
      userId,
      isAuthorized: 0,
      pairingCode,
      pairingCodeExpiresAt,
      pairedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async authorizeTelegramUserByPairingCode(pairingCode: string): Promise<TelegramUserRow | null> {
    const existing = await this.db.query.telegramUsers.findFirst({
      where: eq(telegramUsers.pairingCode, pairingCode),
    });

    if (!existing || !existing.pairingCodeExpiresAt) {
      return null;
    }

    if (Date.parse(existing.pairingCodeExpiresAt) <= Date.now()) {
      return null;
    }

    const now = nowIso();
    await this.db
      .update(telegramUsers)
      .set({
        isAuthorized: 1,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        pairedAt: now,
        updatedAt: now,
      })
      .where(eq(telegramUsers.userId, existing.userId));

    return (await this.getTelegramUserAccess(existing.userId)) ?? null;
  }

  async markTelegramUpdateHandled(chatId: string, updateId: number): Promise<void> {
    const existing = await this.getTelegramChatSession(chatId);
    if (!existing) {
      return;
    }

    const now = nowIso();
    await this.db
      .update(telegramChats)
      .set({
        lastUpdateId: Math.max(existing.lastUpdateId ?? Number.MIN_SAFE_INTEGER, updateId),
        updatedAt: now,
      })
      .where(eq(telegramChats.chatId, chatId));
  }

  async createSessionHandoff(input: {
    fromSessionId: string;
    toSessionId: string;
    summaryMessageId: string;
  }): Promise<SessionHandoffRow> {
    const id = randomUUID();
    const createdAt = nowIso();

    await this.db.insert(sessionHandoffs).values({
      id,
      fromSessionId: input.fromSessionId,
      toSessionId: input.toSessionId,
      summaryMessageId: input.summaryMessageId,
      createdAt,
    });

    return this.getRequiredSessionHandoff(id);
  }

  async listSessionHandoffsFrom(sessionId: string): Promise<SessionHandoffRow[]> {
    return this.db.query.sessionHandoffs.findMany({
      where: eq(sessionHandoffs.fromSessionId, sessionId),
      orderBy: asc(sessionHandoffs.createdAt),
    });
  }

  async createThread(sessionId: string, title = "New chat"): Promise<ThreadRow> {
    const now = nowIso();
    const id = randomUUID();

    await this.db.insert(threads).values({
      id,
      sessionId,
      title,
      createdAt: now,
      updatedAt: now,
    });

    await this.db
      .update(sessions)
      .set({
        lastThreadId: id,
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    return this.getRequiredThread(id, sessionId);
  }

  async listThreadsForSession(sessionId: string): Promise<ThreadRow[]> {
    return this.db.query.threads.findMany({
      where: eq(threads.sessionId, sessionId),
      orderBy: (thread, { desc }) => [desc(thread.updatedAt), desc(thread.createdAt)],
    });
  }

  async getThreadForSession(threadId: string, sessionId: string) {
    return this.db.query.threads.findFirst({
      where: and(eq(threads.id, threadId), eq(threads.sessionId, sessionId)),
    });
  }

  async createMessage(input: {
    threadId: string;
    role: "user" | "assistant";
    content: string;
    status: "pending" | "streaming" | "completed" | "error";
  }): Promise<MessageRow> {
    const id = randomUUID();
    const now = nowIso();

    await this.db.insert(messages).values({
      id,
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      status: input.status,
      createdAt: now,
    });

    await this.touchThread(input.threadId, now);
    return this.getRequiredMessage(id);
  }

  async listMessages(threadId: string): Promise<MessageRow[]> {
    return this.db.query.messages.findMany({
      where: eq(messages.threadId, threadId),
      orderBy: asc(messages.createdAt),
    });
  }

  async updateMessage(
    id: string,
    patch: Partial<Pick<MessageRow, "content" | "status">>,
  ): Promise<MessageRow> {
    const existing = await this.getRequiredMessage(id);
    await this.db
      .update(messages)
      .set({
        content: patch.content ?? existing.content,
        status: patch.status ?? existing.status,
      })
      .where(eq(messages.id, id));
    await this.touchThread(existing.threadId);
    return this.getRequiredMessage(id);
  }

  async createRun(input: {
    threadId: string;
    userMessageId: string;
    assistantMessageId: string;
  }): Promise<RunRow> {
    const id = randomUUID();
    await this.db.insert(runs).values({
      id,
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      status: "pending",
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    return this.getRequiredRun(id);
  }

  async getRunForSession(runId: string, sessionId: string) {
    const run = await this.db.query.runs.findFirst({
      where: eq(runs.id, runId),
    });

    if (!run) {
      return null;
    }

    const thread = await this.getThreadForSession(run.threadId, sessionId);
    if (!thread) {
      return null;
    }

    return run;
  }

  async updateRun(
    id: string,
    patch: Partial<Pick<RunRow, "status" | "error" | "startedAt" | "finishedAt">>,
  ): Promise<RunRow> {
    const existing = await this.getRequiredRun(id);
    await this.db
      .update(runs)
      .set({
        status: patch.status ?? existing.status,
        error: patch.error ?? existing.error,
        startedAt: patch.startedAt ?? existing.startedAt,
        finishedAt: patch.finishedAt ?? existing.finishedAt,
      })
      .where(eq(runs.id, id));
    return this.getRequiredRun(id);
  }

  async getThreadMessagesForRun(runId: string, sessionId: string) {
    const run = await this.getRunForSession(runId, sessionId);
    if (!run) {
      return null;
    }

    const thread = await this.getRequiredThread(run.threadId, sessionId);
    const threadMessages = await this.listMessages(thread.id);
    return { run, thread, messages: threadMessages };
  }

  private async getRequiredSession(id: string) {
    const session = await this.getSession(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    return session;
  }

  private async getRequiredThread(threadId: string, sessionId: string) {
    const thread = await this.getThreadForSession(threadId, sessionId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return thread;
  }

  private async getRequiredMessage(id: string) {
    const message = await this.db.query.messages.findFirst({
      where: eq(messages.id, id),
    });
    if (!message) {
      throw new Error(`Message not found: ${id}`);
    }
    return message;
  }

  private async getRequiredRun(id: string) {
    const run = await this.db.query.runs.findFirst({
      where: eq(runs.id, id),
    });
    if (!run) {
      throw new Error(`Run not found: ${id}`);
    }
    return run;
  }

  private async getRequiredSessionHandoff(id: string) {
    const handoff = await this.db.query.sessionHandoffs.findFirst({
      where: eq(sessionHandoffs.id, id),
    });
    if (!handoff) {
      throw new Error(`Session handoff not found: ${id}`);
    }
    return handoff;
  }

  private async touchThread(threadId: string, updatedAt = nowIso()) {
    await this.db
      .update(threads)
      .set({
        updatedAt,
      })
      .where(eq(threads.id, threadId));
  }
}

function nowIso() {
  return new Date().toISOString();
}
