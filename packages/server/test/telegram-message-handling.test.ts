import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/database.js";
import { handleTelegramMessage } from "../src/telegramBot.js";
import { ChatRepository } from "../src/repository.js";
import { createTelegramTransport } from "./telegram-test-helpers.js";

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
    const repository = new ChatRepository(database.db);
    const originalSession = await repository.createSession("00000000-0000-4000-8000-000000000003");
    await repository.createThread(originalSession.id);
    await repository.setTelegramChatSession("42", originalSession.id);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));

    await handleTelegramMessage({
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
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const telegram = createTelegramTransport();
    const agentRunner = vi.fn(async () => ({ text: "unused" }));

    await handleTelegramMessage({
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

  it("remaps Telegram chats to the compacted session when the engine hands off", async () => {
    const database = createDatabase();
    databases.push(database);
    const repository = new ChatRepository(database.db);
    const originalSession = await repository.createSession("00000000-0000-4000-8000-000000000031");
    const originalThread = await repository.createThread(originalSession.id);
    await repository.setTelegramChatSession("42", originalSession.id);
    const telegram = createTelegramTransport();

    await handleTelegramMessage({
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
