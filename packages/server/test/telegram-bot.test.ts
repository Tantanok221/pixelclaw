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

  it("serializes final Telegram edits so completion does not race a scheduled flush", async () => {
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
    const sentMessages: SentMessage[] = [];
    const editedMessages: EditedMessage[] = [];
    let nextMessageId = 1;
    const pendingEdits = new Set<string>();

    await expect(
      telegramBot.handleTelegramMessage?.({
        chatId: "42",
        text: "Race the flush",
        repository,
        agentRunner: async ({ onEvent }) => {
          await onEvent({ type: "run.started" });
          await onEvent({ type: "message.delta", delta: "Hello world" });
          await onEvent({ type: "message.completed", text: "Hello world" });
          return { text: "Hello world" };
        },
        telegram: {
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
            const key = `${messageId}:${text}`;
            if (pendingEdits.has(key)) {
              throw new Error("Telegram API request failed with status 400");
            }

            pendingEdits.add(key);
            await new Promise((resolve) => setTimeout(resolve, 10));
            pendingEdits.delete(key);
            editedMessages.push({ chatId, messageId, text });
          },
        },
        streamOptions: {
          editIntervalMs: 1,
          maxMessageLength: 4096,
          placeholderText: "...",
        },
      }),
    ).resolves.toBeUndefined();

    expect(sentMessages).toEqual([
      {
        chatId: "42",
        text: "...",
        messageId: 1,
      },
    ]);
    expect(editedMessages).toEqual([
      {
        chatId: "42",
        messageId: 1,
        text: "Hello world",
      },
    ]);
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

  it("serializes overlapping Telegram edits while completing a streamed reply", async () => {
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
    const editsInFlight = new Set<string>();
    const originalEditMessageText = telegram.editMessageText;
    let releaseFirstEdit: (() => void) | undefined;
    const firstEditSettled = new Promise<void>((resolve) => {
      releaseFirstEdit = resolve;
    });

    telegram.editMessageText = async (chatId, messageId, text) => {
      const editKey = `${messageId}:${text}`;
      if (editsInFlight.has(editKey)) {
        throw new Error("Telegram API request failed with status 400");
      }

      editsInFlight.add(editKey);
      try {
        await originalEditMessageText(chatId, messageId, text);
        if (telegram.editedMessages.length === 1) {
          await firstEditSettled;
        }
      } finally {
        editsInFlight.delete(editKey);
      }
    };

    await expect(
      telegramBot.handleTelegramMessage?.({
        chatId: "42",
        text: "Trigger overlap",
        repository,
        agentRunner: async ({ onEvent }) => {
          await onEvent({ type: "run.started" });
          await onEvent({ type: "message.delta", delta: "Hello" });
          await new Promise((resolve) => setTimeout(resolve, 20));

          const completion = onEvent({ type: "message.completed", text: "Hello" });
          await new Promise((resolve) => setTimeout(resolve, 20));
          releaseFirstEdit?.();
          await completion;

          return { text: "Hello" };
        },
        telegram,
        streamOptions: {
          editIntervalMs: 5,
          maxMessageLength: 4096,
          placeholderText: "...",
        },
      }),
    ).resolves.toBeUndefined();

    expect(telegram.editedMessages).toEqual([
      {
        chatId: "42",
        messageId: 1,
        text: "Hello",
      },
    ]);
  });

  it("ignores duplicate Telegram updates in the same polling batch", async () => {
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
        await onEvent({ type: "message.completed", text: "pong" });
        return { text: "pong" };
      },
      telegram: {
        ...telegram,
        async getUpdates(_offset, _timeoutSeconds, signal) {
          updateCalls += 1;
          if (updateCalls === 1) {
            return [
              { updateId: 1, chatId: "99", text: "ping" },
              { updateId: 1, chatId: "99", text: "ping" },
            ];
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
      expect(telegram.sentMessages).toHaveLength(1);
      expect(telegram.editedMessages).toEqual([
        {
          chatId: "99",
          messageId: 1,
          text: "pong",
        },
      ]);
    });

    await expect(controller?.close()).resolves.toBeUndefined();
  });

  it("does not reply twice when Telegram replays an already handled update after restart", async () => {
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

    const createReplayPollingTransport = (): {
      getUpdates: (
        offset: number,
        timeoutSeconds: number,
        signal?: AbortSignal,
      ) => Promise<Array<{ updateId: number; chatId: string; text: string }>>;
      sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
      editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
    } => {
      let updateCalls = 0;

      return {
        ...telegram,
        async getUpdates(_offset: number, _timeoutSeconds: number, signal?: AbortSignal) {
          updateCalls += 1;
          if (updateCalls === 1) {
            return [{ updateId: 7, chatId: "99", text: "ping" }];
          }

          return await new Promise((resolve) => {
            signal?.addEventListener("abort", () => resolve([]), { once: true });
          });
        },
      };
    };

    const runAgent = async ({
      onEvent,
    }: {
      onEvent: (event: { type: string; delta?: string; text?: string }) => void | Promise<void>;
    }) => {
      await onEvent({ type: "run.started" });
      await onEvent({ type: "message.completed", text: "pong" });
      return { text: "pong" };
    };

    const firstController = await telegramBot.startTelegramBot?.({
      repository,
      agentRunner: runAgent,
      telegram: createReplayPollingTransport(),
      pollTimeoutSeconds: 0,
      retryDelayMs: 0,
    });

    await waitFor(() => {
      expect(telegram.editedMessages).toContainEqual({
        chatId: "99",
        messageId: 1,
        text: "pong",
      });
    });

    await expect(firstController?.close()).resolves.toBeUndefined();

    const secondController = await telegramBot.startTelegramBot?.({
      repository,
      agentRunner: runAgent,
      telegram: createReplayPollingTransport(),
      pollTimeoutSeconds: 0,
      retryDelayMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(secondController?.close()).resolves.toBeUndefined();

    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.editedMessages).toHaveLength(1);
  });

  it("aborts the active Telegram run and drops queued updates on /stop", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      startTelegramBot?: (options: {
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; delta?: string; text?: string }) => void | Promise<void>;
          signal?: AbortSignal;
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
      agentRunner: async ({ onEvent, signal }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "message.delta", delta: "Working..." });

        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }

          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });

        return { text: "should never complete" };
      },
      telegram: {
        ...telegram,
        async getUpdates(_offset, _timeoutSeconds, signal) {
          updateCalls += 1;
          if (updateCalls === 1) {
            return [
              { updateId: 1, chatId: "77", text: "Start a long task" },
              { updateId: 2, chatId: "77", text: "This should be dropped" },
              { updateId: 3, chatId: "77", text: "/stop" },
            ];
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
      expect(telegram.sentMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chatId: "77",
            text: "Stopping current activity.",
          }),
        ]),
      );
      expect(telegram.sentMessages).toHaveLength(2);

      const mapping = await repository.getTelegramChatSession("77");
      expect(mapping).toBeTruthy();

      const threads = await repository.listThreadsForSession(mapping!.sessionId);
      expect(threads).toHaveLength(1);

      const messages = await repository.listMessages(threads[0]!.id);
      expect(messages).toMatchObject([
        {
          role: "user",
          content: "Start a long task",
          status: "completed",
        },
        {
          role: "assistant",
          content: "Stopped.",
          status: "error",
        },
      ]);
      expect(messages).toHaveLength(2);
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
