import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/database.js";
import type { RunAgentOptions } from "../src/defaultAgentRunner.js";
import { ChatRepository } from "../src/repository.js";
import { startTelegramBot } from "../src/telegramBot.js";
import { createTelegramTransport, waitFor } from "./telegram-test-helpers.js";

describe("Telegram polling and coordination", () => {
  const databases: Array<{ sqlite: { close: () => void } }> = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
      database.sqlite.close();
    }
  });

  it("starts polling when configured and shuts down cleanly", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    let updateCalls = 0;

    const controller = await startTelegramBot({
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
        text: "...",
        messageId: 2,
      });
      expect(telegram.editedMessages).toContainEqual({
        chatId: "99",
        messageId: 2,
        text: "pong",
      });
    });

    await expect(controller?.close()).resolves.toBeUndefined();
  });

  it("ignores duplicate Telegram updates in the same polling batch", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    let updateCalls = 0;

    const controller = await startTelegramBot({
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
        text: "...",
        messageId: 2,
      });
      expect(telegram.editedMessages).toContainEqual({
        chatId: "99",
        messageId: 2,
        text: "pong",
      });
    });

    await expect(controller?.close()).resolves.toBeUndefined();
  });

  it("does not reply twice when Telegram replays an already handled update after restart", async () => {
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

    const runAgent = async ({ onEvent }: RunAgentOptions) => {
      await onEvent({ type: "run.started" });
      await onEvent({ type: "message.completed", text: "pong" });
      return { text: "pong" };
    };

    const firstController = await startTelegramBot({
      repository,
      agentRunner: runAgent,
      telegram: createReplayPollingTransport(),
      pollTimeoutSeconds: 0,
      retryDelayMs: 0,
    });

    await waitFor(() => {
      expect(telegram.sentMessages).toContainEqual({
        chatId: "99",
        text: "...",
        messageId: 2,
      });
      expect(telegram.editedMessages).toContainEqual({
        chatId: "99",
        messageId: 2,
        text: "pong",
      });
    });

    await expect(firstController?.close()).resolves.toBeUndefined();

    const secondController = await startTelegramBot({
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
      text: "...",
      messageId: 2,
    });
    expect(telegram.editedMessages).toContainEqual({
      chatId: "99",
      messageId: 2,
      text: "pong",
    });
  });

  it("aborts the active Telegram run and drops queued updates on /stop", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    let updateCalls = 0;

    const controller = await startTelegramBot({
      repository,
      agentRunner: async ({ onEvent, signal }) => {
        await onEvent({ type: "run.started" });
        await onEvent({
          type: "tool.started",
          toolName: "bash",
          args: { command: "npm test" },
        });

        await new Promise<void>((_resolve, reject) => {
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
      const placeholderMessage = telegram.sentMessages.find(
        (message) => message.chatId === "77" && message.text === "...",
      );
      expect(placeholderMessage).toBeTruthy();
      expect(telegram.editedMessages).toContainEqual({
        chatId: "77",
        messageId: placeholderMessage!.messageId,
        text: "Stopped.",
      });
    });

    await expect(controller?.close()).resolves.toBeUndefined();
  });
});
