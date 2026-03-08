import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/database.js";
import { handleTelegramMessage } from "../src/telegramBot.js";
import { ChatRepository } from "../src/repository.js";
import { createTelegramTransport } from "./telegram-test-helpers.js";

describe("Telegram message presentation", () => {
  const databases: Array<{ sqlite: { close: () => void } }> = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
      database.sqlite.close();
    }
  });

  it("shows a sticky status message and deletes it after sending the final reply", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    vi.useFakeTimers();

    await handleTelegramMessage({
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
          isError: false,
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
      text: "...",
      messageId: 2,
    });
    expect(telegram.editedMessages.some((message) => message.text.includes("State: planning"))).toBe(
      true,
    );
    expect(
      telegram.editedMessages.some(
        (message) => message.messageId === 2 && message.text === "Hello world",
      ),
    ).toBe(true);
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

  it("creates the streaming reply message immediately and keeps it separate from the sticky status", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    vi.useFakeTimers();

    await handleTelegramMessage({
      chatId: "42",
      text: "Stream this reply",
      repository,
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        expect(telegram.sentMessages).toEqual([
          {
            chatId: "42",
            text: expect.stringContaining("State: starting"),
            messageId: 1,
          },
          {
            chatId: "42",
            text: "Thinking...",
            messageId: 2,
          },
        ]);
        await onEvent({ type: "run.state.changed", state: "planning" });
        await onEvent({ type: "message.delta", delta: "Hello" });
        await onEvent({ type: "message.delta", delta: " world" });
        await onEvent({ type: "message.completed", text: "Hello world" });
        return { text: "Hello world" };
      },
      telegram,
      streamOptions: {
        placeholderText: "Thinking...",
      },
    });

    expect(telegram.sentMessages).toEqual([
      {
        chatId: "42",
        text: expect.stringContaining("State: starting"),
        messageId: 1,
      },
      {
        chatId: "42",
        text: "Thinking...",
        messageId: 2,
      },
    ]);

    expect(
      telegram.editedMessages.some(
        (message) => message.messageId === 1 && message.text.includes("State: planning"),
      ),
    ).toBe(true);
    expect(
      telegram.editedMessages.some(
        (message) => message.messageId === 2 && message.text === "Hello world",
      ),
    ).toBe(true);
    expect(
      telegram.editedMessages.some(
        (message) => message.messageId === 2 && message.text.includes("State: "),
      ),
    ).toBe(false);
    expect(
      telegram.editedMessages.some(
        (message) => message.messageId === 1 && message.text === "Hello world",
      ),
    ).toBe(false);
  });

  it("throttles streamed reply edits and flushes the final reply on completion", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    vi.useFakeTimers();

    await handleTelegramMessage({
      chatId: "42",
      text: "Throttle this reply",
      repository,
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "message.delta", delta: "H" });
        await onEvent({ type: "message.delta", delta: "e" });
        await onEvent({ type: "message.delta", delta: "y" });
        await onEvent({ type: "message.completed", text: "Hey" });
        return { text: "Hey" };
      },
      telegram,
      streamOptions: {
        editIntervalMs: 60_000,
      },
    });

    const replyEdits = telegram.editedMessages.filter((message) => message.messageId === 2);
    expect(replyEdits).toEqual([
      {
        chatId: "42",
        messageId: 2,
        text: "Hey",
      },
    ]);
  });

  it("truncates Telegram reply edits to avoid oversize 400 errors", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const baseTransport = createTelegramTransport();
    const telegram = {
      ...baseTransport,
      async editMessageText(chatId: string, messageId: number, text: string) {
        if (messageId === 2 && text.length > 20) {
          throw new Error("Telegram API request failed with status 400");
        }

        await baseTransport.editMessageText(chatId, messageId, text);
      },
    };

    await expect(
      handleTelegramMessage({
        chatId: "42",
        text: "Long reply",
        repository,
        agentRunner: async ({ onEvent }) => {
          await onEvent({ type: "run.started" });
          await onEvent({
            type: "message.completed",
            text: "123456789012345678901234567890",
          });
          return { text: "123456789012345678901234567890" };
        },
        telegram,
        streamOptions: {
          maxMessageLength: 20,
        },
      }),
    ).resolves.toBeUndefined();

    expect(baseTransport.editedMessages).toContainEqual({
      chatId: "42",
      messageId: 2,
      text: "1234567\n\n[truncated]",
    });
  });

  it("only rotates the whimsical headline at most once every 5 seconds for tool updates", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    vi.useFakeTimers();
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.05)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.15)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.25)
      .mockReturnValue(0.3);

    await handleTelegramMessage({
      chatId: "42",
      text: "Throttle headline changes",
      repository,
      agentRunner: async ({ onEvent }) => {
        await onEvent({ type: "run.started" });
        await onEvent({ type: "tool.started", toolName: "read", args: { path: "a.ts" } });
        await onEvent({
          type: "tool.completed",
          toolName: "read",
          args: { path: "a.ts" },
          isError: false,
        });
        await onEvent({ type: "tool.started", toolName: "bash", args: { command: "echo hi" } });
        await vi.advanceTimersByTimeAsync(5001);
        await onEvent({
          type: "tool.completed",
          toolName: "bash",
          args: { command: "echo hi" },
          isError: false,
        });
        await onEvent({ type: "message.completed", text: "Done" });
        return { text: "Done" };
      },
      telegram,
    });

    const statusMessageId = telegram.sentMessages[0]?.messageId;
    const allStatusTexts = [
      telegram.sentMessages[0]?.text,
      ...telegram.editedMessages
        .filter((message) => message.messageId === statusMessageId)
        .map((message) => message.text),
    ]
      .filter((text): text is string => Boolean(text));
    const headlines = allStatusTexts
      .map((text) => text.split("\n")[0])
      .filter((headline) => headline.length > 0);

    expect(headlines[0]).toBe("Schlepping...");
    expect(headlines[1]).toBe("Schlepping...");
    expect(headlines[2]).toBe("Schlepping...");
    expect(headlines[3]).toBe("Schlepping...");
    expect(headlines[4]).toBe("Combobulating...");
    expect(headlines[5]).toBe("Concocting...");
  });
});
