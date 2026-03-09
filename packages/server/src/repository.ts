import { randomUUID } from "node:crypto";
import type { ServerDaos } from "./dao/index.js";
import type {
  MessageRow,
  RunEventRow,
  RunRow,
  SessionHandoffRow,
  SessionRow,
  TelegramChatRow,
  TelegramUserRow,
  ThreadRow,
} from "./schema.js";

export type RunSource = "web" | "telegram";

export class ChatRepository {
  constructor(private readonly daos: ServerDaos) {}

  async createSession(id = randomUUID()): Promise<SessionRow> {
    const now = nowIso();
    await this.daos.sessions.insert({
      id,
      createdAt: now,
      updatedAt: now,
      lastThreadId: null,
    });
    return this.getRequiredSession(id);
  }

  async getSession(id: string): Promise<SessionRow | undefined> {
    return this.daos.sessions.findById(id);
  }

  async getTelegramChatSession(chatId: string): Promise<TelegramChatRow | undefined> {
    return this.daos.telegramChats.findByChatId(chatId);
  }

  async setTelegramChatSession(chatId: string, sessionId: string): Promise<void> {
    const now = nowIso();
    const existing = await this.getTelegramChatSession(chatId);

    if (existing) {
      await this.daos.telegramChats.updateByChatId(chatId, {
        sessionId,
        updatedAt: now,
      });
      return;
    }

    await this.daos.telegramChats.insert({
      chatId,
      sessionId,
      lastUpdateId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async getTelegramUserAccess(userId: string): Promise<TelegramUserRow | undefined> {
    return this.daos.telegramUsers.findByUserId(userId);
  }

  async saveTelegramPairingCode(
    userId: string,
    pairingCode: string,
    pairingCodeExpiresAt: string,
  ): Promise<void> {
    const now = nowIso();
    const existing = await this.getTelegramUserAccess(userId);

    if (existing) {
      await this.daos.telegramUsers.updateByUserId(userId, {
        isAuthorized: 0,
        pairingCode,
        pairingCodeExpiresAt,
        pairedAt: null,
        updatedAt: now,
      });
      return;
    }

    await this.daos.telegramUsers.insert({
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
    const existing = await this.daos.telegramUsers.findByPairingCode(pairingCode);

    if (!existing || !existing.pairingCodeExpiresAt) {
      return null;
    }

    if (Date.parse(existing.pairingCodeExpiresAt) <= Date.now()) {
      return null;
    }

    const now = nowIso();
    await this.daos.telegramUsers.updateByUserId(existing.userId, {
      isAuthorized: 1,
      pairingCode: null,
      pairingCodeExpiresAt: null,
      pairedAt: now,
      updatedAt: now,
    });

    return (await this.getTelegramUserAccess(existing.userId)) ?? null;
  }

  async markTelegramUpdateHandled(chatId: string, updateId: number): Promise<void> {
    const existing = await this.getTelegramChatSession(chatId);
    if (!existing) {
      return;
    }

    await this.daos.telegramChats.updateByChatId(chatId, {
      lastUpdateId: Math.max(existing.lastUpdateId ?? Number.MIN_SAFE_INTEGER, updateId),
      updatedAt: nowIso(),
    });
  }

  async createSessionHandoff(input: {
    fromSessionId: string;
    toSessionId: string;
    summaryMessageId: string;
  }): Promise<SessionHandoffRow> {
    const id = randomUUID();
    const createdAt = nowIso();

    await this.daos.sessionHandoffs.insert({
      id,
      fromSessionId: input.fromSessionId,
      toSessionId: input.toSessionId,
      summaryMessageId: input.summaryMessageId,
      createdAt,
    });

    return this.getRequiredSessionHandoff(id);
  }

  async listSessionHandoffsFrom(sessionId: string): Promise<SessionHandoffRow[]> {
    return this.daos.sessionHandoffs.listByFromSession(sessionId);
  }

  async createThread(sessionId: string, title = "New chat"): Promise<ThreadRow> {
    const now = nowIso();
    const id = randomUUID();

    await this.daos.threads.insert({
      id,
      sessionId,
      title,
      createdAt: now,
      updatedAt: now,
    });

    await this.daos.sessions.updateById(sessionId, {
      lastThreadId: id,
      updatedAt: now,
    });

    return this.getRequiredThread(id, sessionId);
  }

  async listThreadsForSession(sessionId: string): Promise<ThreadRow[]> {
    return this.daos.threads.listBySession(sessionId);
  }

  async getThreadForSession(threadId: string, sessionId: string): Promise<ThreadRow | undefined> {
    return this.daos.threads.findByIdForSession(threadId, sessionId);
  }

  async createMessage(input: {
    threadId: string;
    role: "user" | "assistant";
    content: string;
    status: "pending" | "streaming" | "completed" | "error";
  }): Promise<MessageRow> {
    const id = randomUUID();
    const now = nowIso();

    await this.daos.messages.insert({
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
    return this.daos.messages.listByThread(threadId);
  }

  async updateMessage(
    id: string,
    patch: Partial<Pick<MessageRow, "content" | "status">>,
  ): Promise<MessageRow> {
    const existing = await this.getRequiredMessage(id);
    await this.daos.messages.updateById(id, {
      content: patch.content ?? existing.content,
      status: patch.status ?? existing.status,
    });
    await this.touchThread(existing.threadId);
    return this.getRequiredMessage(id);
  }

  async createRun(input: {
    threadId: string;
    userMessageId: string;
    assistantMessageId: string;
    source: RunSource;
  }): Promise<RunRow> {
    const id = randomUUID();
    await this.daos.runs.insert({
      id,
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      source: input.source,
      status: "pending",
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    return this.getRequiredRun(id);
  }

  async createRunEvent(input: {
    runId: string;
    threadId: string;
    sessionId: string;
    source: RunSource;
    type: string;
    payload?: unknown;
  }): Promise<RunEventRow> {
    const id = randomUUID();
    const createdAt = nowIso();

    await this.daos.runEvents.insert({
      id,
      runId: input.runId,
      threadId: input.threadId,
      sessionId: input.sessionId,
      source: input.source,
      type: input.type,
      payload: serializePayload(input.payload),
      createdAt,
    });

    return this.getRequiredRunEvent(id);
  }

  async listRunEvents(runId: string): Promise<Array<RunEventRow & { parsedPayload: unknown }>> {
    const events = await this.daos.runEvents.listByRun(runId);

    return events.map((event) => ({
      ...event,
      parsedPayload: parsePayload(event.payload),
    }));
  }

  async getRunForSession(runId: string, sessionId: string): Promise<RunRow | null> {
    const run = await this.daos.runs.findById(runId);
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
    await this.daos.runs.updateById(id, {
      status: patch.status ?? existing.status,
      error: patch.error ?? existing.error,
      startedAt: patch.startedAt ?? existing.startedAt,
      finishedAt: patch.finishedAt ?? existing.finishedAt,
    });
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

  async listAdminRuns() {
    const allRuns = await this.daos.runs.listAll();

    const items = await Promise.all(
      allRuns.map(async (run) => {
        const thread = await this.getRequiredThreadById(run.threadId);
        const assistantMessage = await this.getRequiredMessage(run.assistantMessageId);
        const latestEvent = (await this.listRunEvents(run.id)).at(-1);

        return {
          id: run.id,
          threadId: thread.id,
          threadTitle: thread.title,
          sessionId: thread.sessionId,
          status: run.status,
          source: run.source,
          error: run.error,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          latestEventType: latestEvent?.type ?? null,
          latestEventAt: latestEvent?.createdAt ?? run.finishedAt ?? run.startedAt ?? assistantMessage.createdAt,
          preview: run.error || assistantMessage.content,
        };
      }),
    );

    return items.sort((left, right) => {
      const statusDelta = statusPriority(left.status) - statusPriority(right.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return right.latestEventAt.localeCompare(left.latestEventAt);
    });
  }

  async getAdminOverview() {
    const runsForAdmin = await this.listAdminRuns();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const activeStatuses = new Set(["pending", "streaming"]);
    const activeSessionIds = new Set(
      runsForAdmin.filter((run) => activeStatuses.has(run.status)).map((run) => run.sessionId),
    );

    return {
      counts: {
        activeRuns: runsForAdmin.filter((run) => activeStatuses.has(run.status)).length,
        failedRunsLast24Hours: runsForAdmin.filter(
          (run) => run.status === "failed" && toEpoch(run.latestEventAt) >= cutoff,
        ).length,
        runsLast24Hours: runsForAdmin.filter((run) => toEpoch(run.latestEventAt) >= cutoff).length,
        activeSessions: activeSessionIds.size,
      },
    };
  }

  async getAdminRun(runId: string) {
    const run = await this.getRequiredRun(runId);
    const thread = await this.getRequiredThreadById(run.threadId);
    const threadMessages = await this.listMessages(thread.id);
    const latestEvent = (await this.listRunEvents(run.id)).at(-1);

    return {
      run: {
        id: run.id,
        threadId: thread.id,
        threadTitle: thread.title,
        sessionId: thread.sessionId,
        status: run.status,
        source: run.source,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        latestEventType: latestEvent?.type ?? null,
      },
      messages: threadMessages,
    };
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

  private async getRequiredThreadById(id: string) {
    const thread = await this.daos.threads.findById(id);
    if (!thread) {
      throw new Error(`Thread not found: ${id}`);
    }
    return thread;
  }

  private async getRequiredMessage(id: string) {
    const message = await this.daos.messages.findById(id);
    if (!message) {
      throw new Error(`Message not found: ${id}`);
    }
    return message;
  }

  private async getRequiredRun(id: string) {
    const run = await this.daos.runs.findById(id);
    if (!run) {
      throw new Error(`Run not found: ${id}`);
    }
    return run;
  }

  private async getRequiredRunEvent(id: string) {
    const event = await this.daos.runEvents.findById(id);
    if (!event) {
      throw new Error(`Run event not found: ${id}`);
    }
    return event;
  }

  private async getRequiredSessionHandoff(id: string) {
    const handoff = await this.daos.sessionHandoffs.findById(id);
    if (!handoff) {
      throw new Error(`Session handoff not found: ${id}`);
    }
    return handoff;
  }

  private async touchThread(threadId: string, updatedAt = nowIso()) {
    await this.daos.threads.updateById(threadId, { updatedAt });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function serializePayload(payload: unknown) {
  if (payload === undefined) {
    return "{}";
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ value: String(payload) });
  }
}

function parsePayload(payload: string) {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return { raw: payload };
  }
}

function statusPriority(status: string) {
  switch (status) {
    case "pending":
    case "streaming":
      return 0;
    case "failed":
      return 1;
    default:
      return 2;
  }
}

function toEpoch(value: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
