import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/database.js";
import { handleTelegramMessage } from "../src/telegramBot.js";
import { ChatRepository } from "../src/repository.js";
import { createTelegramTransport, pairTelegramUser } from "./telegram-test-helpers.js";

describe("Telegram message handling", () => {
  const databases: Array<{ sqlite: { close: () => void } }> = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const database of databases.splice(0)) {
      database.sqlite.close();
    }
  });

  it("resets the Telegram chat to a fresh session on /new", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.daos);
    const originalSession = await repository.createSession("00000000-0000-4000-8000-000000000003");
    await repository.createThread(originalSession.id);
    await repository.setTelegramChatSession("42", originalSession.id);
    await pairTelegramUser(repository, "1001");
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));

    await handleTelegramMessage({
      chatId: "42",
      userId: "1001",
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
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.daos);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));
    await pairTelegramUser(repository, "1001");

    await handleTelegramMessage({
      chatId: "42",
      userId: "1001",
      text: "/help",
      repository,
      agentRunner,
      telegram,
    });

    expect(agentRunner).not.toHaveBeenCalled();
    expect(telegram.sentMessages).toEqual([
      {
        chatId: "42",
        text: [
          "Available commands:",
          '/new - Start a new chat.',
          "/mode work - Use the work agent with tools.",
          "/mode chat - Use the chat voice agent.",
          "/stop - Stop the current activity.",
        ].join("\n"),
        messageId: 1,
      },
    ]);
  });

  it("switches the Telegram chat into chat mode on /mode chat", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.daos);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));
    await pairTelegramUser(repository, "1001");

    await handleTelegramMessage({
      chatId: "42",
      userId: "1001",
      text: "/mode chat",
      repository,
      agentRunner,
      telegram,
    });

    expect(agentRunner).not.toHaveBeenCalled();
    await expect(repository.getTelegramChatSession("42")).resolves.toMatchObject({
      chatId: "42",
      mode: "chat",
    });
    expect(telegram.sentMessages).toEqual([
      {
        chatId: "42",
        text: 'Mode set to "chat".',
        messageId: 1,
      },
    ]);
  });

  it("remaps Telegram chats to the compacted session when the engine hands off", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.daos);
    const originalSession = await repository.createSession("00000000-0000-4000-8000-000000000031");
    const originalThread = await repository.createThread(originalSession.id);
    await repository.setTelegramChatSession("42", originalSession.id);
    await pairTelegramUser(repository, "1001");
    const telegram = createTelegramTransport();

    await handleTelegramMessage({
      chatId: "42",
      userId: "1001",
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

  it("blocks unpaired Telegram users and sends a local pairing command", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.daos);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));

    await handleTelegramMessage({
      chatId: "42",
      userId: "7001",
      text: "hello",
      repository,
      agentRunner,
      telegram,
    });

    expect(agentRunner).not.toHaveBeenCalled();
    expect(telegram.sentMessages).toHaveLength(1);
    expect(telegram.sentMessages[0]).toMatchObject({
      chatId: "42",
    });
    expect(telegram.sentMessages[0]?.text).toMatch(
      /npm run pair:telegram -- [A-Z0-9-]+/,
    );
  });

  it("allows a paired Telegram user to access the bot from another chat", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.daos);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async ({ onEvent }) => {
      await onEvent({ type: "run.started" });
      await onEvent({ type: "message.completed", text: "paired reply" });
      return { text: "paired reply" };
    });

    await handleTelegramMessage({
      chatId: "42",
      userId: "7001",
      text: "hello",
      repository,
      agentRunner,
      telegram,
    });

    const pairingMessage = telegram.sentMessages[0]?.text ?? "";
    const pairingCode = pairingMessage.match(/npm run pair:telegram -- ([A-Z0-9-]+)/)?.[1];
    expect(pairingCode).toBeTruthy();

    await repository.authorizeTelegramUserByPairingCode(pairingCode!);

    telegram.sentMessages.length = 0;

    await handleTelegramMessage({
      chatId: "84",
      userId: "7001",
      text: "hello again",
      repository,
      agentRunner,
      telegram,
    });

    expect(agentRunner).toHaveBeenCalledTimes(1);
    expect(telegram.sentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chatId: "84",
          text: "...",
        }),
      ]),
    );
  });

  it("runs the chat voice agent when the Telegram chat is in chat mode", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.daos);
    const telegram = createTelegramTransport();
    await pairTelegramUser(repository, "7001");
    const session = await repository.createSession("00000000-0000-4000-8000-000000000099");
    await repository.createThread(session.id);
    await repository.setTelegramChatSession("84", session.id);
    await repository.setTelegramChatMode("84", "chat");
    const agentRunner = vi.fn(async ({ mode, onEvent }) => {
      expect(mode).toBe("chat");
      await onEvent({ type: "run.started" });
      await onEvent({ type: "message.completed", text: "chat reply" });
      return { text: "chat reply" };
    });

    await handleTelegramMessage({
      chatId: "84",
      userId: "7001",
      text: "hello again",
      repository,
      agentRunner,
      telegram,
    });

    expect(agentRunner).toHaveBeenCalledTimes(1);
  });
});
