import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/database.js";
import { ChatRepository } from "../src/repository.js";

interface SentMessage {
  chatId: string;
  text: string;
  messageId: number;
}

interface EditedMessage {
  chatId: string;
  messageId: number;
  text: string;
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  await assertion();
}

function createTelegramTransport() {
  const sentMessages: SentMessage[] = [];
  const editedMessages: EditedMessage[] = [];
  let nextMessageId = 1;

  return {
    sentMessages,
    editedMessages,
    async sendMessage(chatId: string, text: string) {
      const message = {
        chatId,
        text,
        messageId: nextMessageId++,
      };
      sentMessages.push(message);
      return { messageId: message.messageId };
    },
    async editMessageText(chatId: string, messageId: number, text: string) {
      editedMessages.push({ chatId, messageId, text });
    },
  };
}

describe("Telegram bot message handling", () => {
  const databases: Array<{ sqlite: { close: () => void } }> = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
      database.sqlite.close();
    }
  });

  it("creates and streams a Telegram-backed agent conversation", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      handleTelegramMessage?: (options: {
        chatId: string;
        text: string;
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; delta?: string; text?: string }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
        };
        streamOptions?: {
          editIntervalMs?: number;
          maxMessageLength?: number;
          placeholderText?: string;
        };
      }) => Promise<void>;
    };

    expect(telegramBot.handleTelegramMessage).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();

    await telegramBot.handleTelegramMessage?.({
      chatId: "42",
      text: "Hello from Telegram",
      repository,
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "message.delta", delta: "Hello" });
        await onEvent({ type: "message.delta", delta: " world" });
        await onEvent({ type: "message.completed", text: "Hello world" });
        return { text: "Hello world" };
      },
      telegram,
      streamOptions: {
        editIntervalMs: 0,
        maxMessageLength: 4096,
        placeholderText: "...",
      },
    });

    const telegramChat = await repository.getTelegramChatSession("42");
    expect(telegramChat).toBeTruthy();

    const threads = await repository.listThreadsForSession(telegramChat!.sessionId);
    expect(threads).toHaveLength(1);

    const messages = await repository.listMessages(threads[0]!.id);
    expect(messages).toMatchObject([
      {
        role: "user",
        content: "Hello from Telegram",
        status: "completed",
      },
      {
        role: "assistant",
        content: "Hello world",
        status: "completed",
      },
    ]);

    expect(telegram.sentMessages).toEqual([
      {
        chatId: "42",
        text: "...",
        messageId: 1,
      },
    ]);
    expect(telegram.editedMessages.at(-1)).toEqual({
      chatId: "42",
      messageId: 1,
      text: "Hello world",
    });
  });

  it("resets the Telegram chat to a fresh session on /new", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      handleTelegramMessage?: (options: {
        chatId: string;
        text: string;
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
        };
      }) => Promise<void>;
    };

    expect(telegramBot.handleTelegramMessage).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const originalSession = await repository.createSession("00000000-0000-4000-8000-000000000003");
    await repository.createThread(originalSession.id);
    await repository.setTelegramChatSession("42", originalSession.id);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));

    await telegramBot.handleTelegramMessage?.({
      chatId: "42",
      text: "/new",
      repository,
      agentRunner,
      telegram,
    });

    const mapping = await repository.getTelegramChatSession("42");
    expect(mapping?.sessionId).not.toBe(originalSession.id);
    expect(agentRunner).not.toHaveBeenCalled();
    expect(telegram.sentMessages).toEqual([
      {
        chatId: "42",
        text: "Started a new chat.",
        messageId: 1,
      },
    ]);

    const threads = await repository.listThreadsForSession(mapping!.sessionId);
    expect(threads).toHaveLength(1);
  });

  it("rolls over long streamed replies into additional Telegram messages", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      handleTelegramMessage?: (options: {
        chatId: string;
        text: string;
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; delta?: string; text?: string }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
        };
        streamOptions?: {
          editIntervalMs?: number;
          maxMessageLength?: number;
          placeholderText?: string;
        };
      }) => Promise<void>;
    };

    expect(telegramBot.handleTelegramMessage).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();

    await telegramBot.handleTelegramMessage?.({
      chatId: "42",
      text: "Send a long reply",
      repository,
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "message.delta", delta: "1234567890" });
        await onEvent({ type: "message.delta", delta: "abcdefghij" });
        await onEvent({ type: "message.completed", text: "1234567890abcdefghij" });
        return { text: "1234567890abcdefghij" };
      },
      telegram,
      streamOptions: {
        editIntervalMs: 0,
        maxMessageLength: 12,
        placeholderText: "...",
      },
    });

    expect(telegram.sentMessages).toEqual([
      {
        chatId: "42",
        text: "...",
        messageId: 1,
      },
      {
        chatId: "42",
        text: "...",
        messageId: 2,
      },
    ]);
    expect(telegram.editedMessages).toContainEqual({
      chatId: "42",
      messageId: 1,
      text: "1234567890",
    });
    expect(telegram.editedMessages.at(-1)).toEqual({
      chatId: "42",
      messageId: 2,
      text: "abcdefghij",
    });
  });

  it("starts polling when configured and shuts down cleanly", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      startTelegramBot?: (options: {
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; delta?: string; text?: string }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          getUpdates: (
            offset: number,
            timeoutSeconds: number,
            signal?: AbortSignal,
          ) => Promise<Array<{ updateId: number; chatId: string; text: string }>>;
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
        };
        pollTimeoutSeconds?: number;
        retryDelayMs?: number;
      }) => Promise<{ close: () => Promise<void> } | null>;
    };

    expect(telegramBot.startTelegramBot).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    let updateCalls = 0;

    const controller = await telegramBot.startTelegramBot?.({
      repository,
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "message.delta", delta: "pong" });
        await onEvent({ type: "message.completed", text: "pong" });
        return { text: "pong" };
      },
      telegram: {
        ...telegram,
        async getUpdates(_offset, _timeoutSeconds, signal) {
          updateCalls += 1;
          if (updateCalls === 1) {
            return [{ updateId: 1, chatId: "99", text: "ping" }];
          }

          return await new Promise((resolve) => {
            signal?.addEventListener("abort", () => resolve([]), { once: true });
          });
        },
      },
      pollTimeoutSeconds: 0,
      retryDelayMs: 0,
    });

    await waitFor(async () => {
      const mapping = await repository.getTelegramChatSession("99");
      expect(mapping).toBeTruthy();
      expect(telegram.editedMessages.at(-1)).toEqual({
        chatId: "99",
        messageId: 1,
        text: "pong",
      });
    });

    await expect(controller?.close()).resolves.toBeUndefined();
  });

  it("remaps Telegram chats to the compacted session when the engine hands off", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      handleTelegramMessage?: (options: {
        chatId: string;
        text: string;
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; delta?: string; text?: string }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
        };
        compactionEngine?: {
          prepareConversation: (options: {
            repository: ChatRepository;
            session: { id: string };
            thread: { id: string };
            pendingUserMessage: string;
          }) => Promise<{ session: { id: string }; thread: { id: string }; compacted: boolean }>;
        };
        streamOptions?: {
          editIntervalMs?: number;
          maxMessageLength?: number;
          placeholderText?: string;
        };
      }) => Promise<void>;
    };

    expect(telegramBot.handleTelegramMessage).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const originalSession = await repository.createSession("00000000-0000-4000-8000-000000000031");
    const originalThread = await repository.createThread(originalSession.id);
    await repository.setTelegramChatSession("42", originalSession.id);
    const telegram = createTelegramTransport();

    await telegramBot.handleTelegramMessage?.({
      chatId: "42",
      text: "Trigger handoff",
      repository,
      agentRunner: async ({ messages, onEvent, sessionId }) => {
        expect(sessionId).not.toBe(originalSession.id);
        expect(messages).toMatchObject([
          { role: "assistant", content: "Checkpoint summary" },
          { role: "user", content: "Recent user" },
          { role: "assistant", content: "Recent assistant" },
          { role: "user", content: "Trigger handoff" },
        ]);
        await onEvent({ type: "run.started" });
        await onEvent({ type: "message.completed", text: "Handoff reply" });
        return { text: "Handoff reply" };
      },
      telegram,
      compactionEngine: {
        prepareConversation: async ({ repository: currentRepository, session, pendingUserMessage }) => {
          expect(session.id).toBe(originalSession.id);
          const nextSession = await currentRepository.createSession();
          const nextThread = await currentRepository.createThread(nextSession.id);
          await currentRepository.createMessage({
            threadId: nextThread.id,
            role: "assistant",
            content: "Checkpoint summary",
            status: "completed",
          });
          await currentRepository.createMessage({
            threadId: nextThread.id,
            role: "user",
            content: "Recent user",
            status: "completed",
          });
          await currentRepository.createMessage({
            threadId: nextThread.id,
            role: "assistant",
            content: "Recent assistant",
            status: "completed",
          });
          expect(pendingUserMessage).toBe("Trigger handoff");

          return {
            session: nextSession,
            thread: nextThread,
            compacted: true,
          };
        },
      },
      streamOptions: {
        editIntervalMs: 0,
        maxMessageLength: 4096,
        placeholderText: "...",
      },
    });

    const mapping = await repository.getTelegramChatSession("42");
    expect(mapping?.sessionId).not.toBe(originalSession.id);

    const originalMessages = await repository.listMessages(originalThread.id);
    expect(originalMessages).toEqual([]);
  });
});
