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

interface DeletedMessage {
  chatId: string;
  messageId: number;
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
  const deletedMessages: DeletedMessage[] = [];
  let nextMessageId = 1;

  return {
    sentMessages,
    editedMessages,
    deletedMessages,
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
    async deleteMessage(chatId: string, messageId: number) {
      deletedMessages.push({ chatId, messageId });
    },
  };
}

describe("Telegram bot message handling", () => {
  const databases: Array<{ sqlite: { close: () => void } }> = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
      database.sqlite.close();
    }
  });

  it("shows a sticky status message and deletes it after sending the final reply", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      handleTelegramMessage?: (options: {
        chatId: string;
        text: string;
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
        };
      }) => Promise<void>;
    };

    expect(telegramBot.handleTelegramMessage).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    vi.useFakeTimers();

    await telegramBot.handleTelegramMessage?.({
      chatId: "42",
      text: "Hello from Telegram",
      repository,
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "run.state.changed", state: "planning" });
        await onEvent({
          type: "tool.started",
          toolName: "read",
          args: { path: "packages/server/src/telegramBot.ts" },
        });
        await onEvent({
          type: "todo.updated",
          todoDocument: {
            sessionId: "session-42",
            updatedAt: "2026-03-08T00:00:00.000Z",
            todos: [
              {
                id: "todo-1",
                text: "inspect telegram flow",
                status: "done",
                note: "done",
              },
              {
                id: "todo-2",
                text: "add sticky status message",
                status: "in_progress",
                note: "working",
              },
            ],
          },
        });
        await onEvent({
          type: "tool.completed",
          toolName: "read",
          args: { path: "packages/server/src/telegramBot.ts" },
        });
        await onEvent({ type: "message.completed", text: "Hello world" });
        return { text: "Hello world" };
      },
      telegram,
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

    expect(telegram.sentMessages).toHaveLength(2);
    expect(telegram.sentMessages[0]).toEqual({
      chatId: "42",
      text: expect.stringContaining("State: starting"),
      messageId: 1,
    });
    expect(telegram.sentMessages[1]).toEqual({
      chatId: "42",
      text: "Hello world",
      messageId: 2,
    });
    expect(telegram.editedMessages.some((message) => message.text.includes("State: planning"))).toBe(
      true,
    );
    expect(
      telegram.editedMessages.some(
        (message) =>
          message.text.includes("Tool: read") &&
          message.text.includes("Target: packages/server/src/telegramBot.ts") &&
          message.text.includes("✅ inspect telegram flow") &&
          message.text.includes("🔧 add sticky status message"),
      ),
    ).toBe(true);
    expect(telegram.deletedMessages).toEqual([]);

    await vi.advanceTimersByTimeAsync(3000);

    expect(telegram.deletedMessages).toEqual([
      {
        chatId: "42",
        messageId: 1,
      },
    ]);
  });

  it("keeps the sticky status message when the run fails", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      handleTelegramMessage?: (options: {
        chatId: string;
        text: string;
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
        };
      }) => Promise<void>;
    };

    expect(telegramBot.handleTelegramMessage).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    vi.useFakeTimers();

    await expect(
      telegramBot.handleTelegramMessage?.({
        chatId: "42",
        text: "Break it",
        repository,
        agentRunner: async ({ onEvent }) => {
          await onEvent({ type: "run.started" });
          await onEvent({
            type: "tool.started",
            toolName: "bash",
            args: { command: "npm test" },
          });
          throw new Error("Command exited with code 1");
        },
        telegram,
      }),
    ).rejects.toThrow("Command exited with code 1");

    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.sentMessages[0]).toEqual({
      chatId: "42",
      text: expect.stringContaining("State: starting"),
      messageId: 1,
    });
    expect(
      telegram.editedMessages.some(
        (message) =>
          message.text.includes("State: failed") &&
          message.text.includes("Tool: bash") &&
          message.text.includes("Target: npm test") &&
          message.text.includes("Error: Command exited with code 1"),
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);

    expect(telegram.deletedMessages).toEqual([]);
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
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
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

  it("returns deterministic command help on /help", async () => {
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
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
        };
      }) => Promise<void>;
    };

    expect(telegramBot.handleTelegramMessage).toBeTypeOf("function");

    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));

    await telegramBot.handleTelegramMessage?.({
      chatId: "42",
      text: "/help",
      repository,
      agentRunner,
      telegram,
    });

    expect(agentRunner).not.toHaveBeenCalled();
    expect(telegram.sentMessages).toEqual([
      {
        chatId: "42",
        text: "Available commands:\n/new - Start a new chat.\n/stop - Stop the current activity.",
        messageId: 1,
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
          onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          getUpdates: (
            offset: number,
            timeoutSeconds: number,
            signal?: AbortSignal,
          ) => Promise<Array<{ updateId: number; chatId: string; text: string }>>;
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
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
      expect(telegram.sentMessages.at(-1)).toEqual({
        chatId: "99",
        text: "pong",
        messageId: 2,
      });
    });

    await expect(controller?.close()).resolves.toBeUndefined();
  });

  it("ignores duplicate Telegram updates in the same polling batch", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      startTelegramBot?: (options: {
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          getUpdates: (
            offset: number,
            timeoutSeconds: number,
            signal?: AbortSignal,
          ) => Promise<Array<{ updateId: number; chatId: string; text: string }>>;
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
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
      expect(telegram.sentMessages).toHaveLength(2);
      expect(telegram.sentMessages.at(-1)).toEqual({
        chatId: "99",
        text: "pong",
        messageId: 2,
      });
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
          onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          getUpdates: (
            offset: number,
            timeoutSeconds: number,
            signal?: AbortSignal,
          ) => Promise<Array<{ updateId: number; chatId: string; text: string }>>;
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
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

    const createReplayPollingTransport = () => {
      let updateCalls = 0;

      return {
        ...telegram,
        async getUpdates(_offset: number, _timeoutSeconds: number, signal?: AbortSignal) {
          updateCalls += 1;
          if (updateCalls === 1) {
            return [{ updateId: 7, chatId: "99", text: "ping" }];
          }

          return await new Promise<Array<{ updateId: number; chatId: string; text: string }>>(
            (resolve) => {
              signal?.addEventListener("abort", () => resolve([]), { once: true });
            },
          );
        },
      };
    };

    const runAgent = async ({
      onEvent,
    }: {
      onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
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
      expect(telegram.sentMessages).toContainEqual({
        chatId: "99",
        text: "pong",
        messageId: 2,
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

    expect(telegram.sentMessages).toHaveLength(2);
    expect(telegram.sentMessages).toContainEqual({
      chatId: "99",
      text: "pong",
      messageId: 2,
    });
  });

  it("aborts the active Telegram run and drops queued updates on /stop", async () => {
    const telegramBot = (await import("../src/telegramBot.js").catch(() => ({}))) as {
      startTelegramBot?: (options: {
        repository: ChatRepository;
        agentRunner: (options: {
          sessionId: string;
          threadId: string;
          messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
          onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
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
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
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
        await onEvent({
          type: "tool.started",
          toolName: "bash",
          args: { command: "npm test" },
        });

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
          onEvent: (event: { type: string; [key: string]: unknown }) => void | Promise<void>;
        }) => Promise<{ text: string }>;
        telegram: {
          sendMessage: (chatId: string, text: string) => Promise<{ messageId: number }>;
          editMessageText: (chatId: string, messageId: number, text: string) => Promise<void>;
          deleteMessage: (chatId: string, messageId: number) => Promise<void>;
        };
        compactionEngine?: {
          prepareConversation: (options: {
            repository: ChatRepository;
            session: { id: string };
            thread: { id: string };
            pendingUserMessage: string;
          }) => Promise<{ session: { id: string }; thread: { id: string }; compacted: boolean }>;
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
    });

    const mapping = await repository.getTelegramChatSession("42");
    expect(mapping?.sessionId).not.toBe(originalSession.id);

    const originalMessages = await repository.listMessages(originalThread.id);
    expect(originalMessages).toEqual([]);
  });
});
