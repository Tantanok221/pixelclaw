import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { ChatRepository } from "../src/repository.js";

describe("compaction engine", () => {
  it("records session handoffs with a summary message reference", async () => {
    const database = createDatabase();
    const repository = new ChatRepository(database.db);
    const methods = repository as unknown as {
      createSessionHandoff?: (input: {
        fromSessionId: string;
        toSessionId: string;
        summaryMessageId: string;
      }) => Promise<void>;
      listSessionHandoffsFrom?: (
        sessionId: string,
      ) => Promise<Array<{ fromSessionId: string; toSessionId: string; summaryMessageId: string }>>;
    };

    expect(methods.createSessionHandoff).toBeTypeOf("function");
    expect(methods.listSessionHandoffsFrom).toBeTypeOf("function");

    const sourceSession = await repository.createSession("00000000-0000-4000-8000-000000000011");
    const targetSession = await repository.createSession("00000000-0000-4000-8000-000000000012");
    const targetThread = await repository.createThread(targetSession.id);
    const summaryMessage = await repository.createMessage({
      threadId: targetThread.id,
      role: "assistant",
      content: "Checkpoint summary",
      status: "completed",
    });

    await methods.createSessionHandoff?.({
      fromSessionId: sourceSession.id,
      toSessionId: targetSession.id,
      summaryMessageId: summaryMessage.id,
    });

    await expect(methods.listSessionHandoffsFrom?.(sourceSession.id)).resolves.toMatchObject([
      {
        fromSessionId: sourceSession.id,
        toSessionId: targetSession.id,
        summaryMessageId: summaryMessage.id,
      },
    ]);

    database.sqlite.close();
  });

  it("creates a handoff session with summary plus preserved turns above the threshold", async () => {
    const compactionModule = (await import("../src/compactionEngine.js").catch(() => ({}))) as {
      createCompactionEngine?: (options: {
        contextLimitTokens: number;
        compactAtPercent: number;
        preserveLastTurns: number;
        estimateTokens: (input: { messages: Array<{ role: string; content: string }>; pendingUserMessage: string }) => number;
        summarize: (input: { messages: Array<{ role: string; content: string }> }) => Promise<string>;
      }) => {
        prepareConversation: (options: {
          repository: ChatRepository;
          session: { id: string };
          thread: { id: string };
          pendingUserMessage: string;
        }) => Promise<{ session: { id: string }; thread: { id: string }; compacted: boolean }>;
      };
    };

    expect(compactionModule.createCompactionEngine).toBeTypeOf("function");

    const database = createDatabase();
    const repository = new ChatRepository(database.db);
    const session = await repository.createSession("00000000-0000-4000-8000-000000000021");
    const thread = await repository.createThread(session.id);
    await repository.createMessage({
      threadId: thread.id,
      role: "user",
      content: "Old user 1",
      status: "completed",
    });
    await repository.createMessage({
      threadId: thread.id,
      role: "assistant",
      content: "Old assistant 1",
      status: "completed",
    });
    await repository.createMessage({
      threadId: thread.id,
      role: "user",
      content: "Recent user",
      status: "completed",
    });
    await repository.createMessage({
      threadId: thread.id,
      role: "assistant",
      content: "Recent assistant",
      status: "completed",
    });

    const summarizeCalls: Array<Array<{ role: string; content: string }>> = [];
    const engine = compactionModule.createCompactionEngine?.({
      contextLimitTokens: 100,
      compactAtPercent: 0.95,
      preserveLastTurns: 1,
      estimateTokens: () => 96,
      summarize: async ({ messages }) => {
        summarizeCalls.push(messages);
        return "Compacted summary";
      },
    });

    const prepared = await engine?.prepareConversation({
      repository,
      session,
      thread,
      pendingUserMessage: "Next prompt",
    });

    expect(prepared?.compacted).toBe(true);
    expect(prepared?.session.id).not.toBe(session.id);
    expect(summarizeCalls).toEqual([
      [
        { role: "user", content: "Old user 1" },
        { role: "assistant", content: "Old assistant 1" },
      ],
    ]);

    const preparedMessages = await repository.listMessages(prepared!.thread.id);
    expect(preparedMessages).toMatchObject([
      { role: "assistant", content: "Compacted summary", status: "completed" },
      { role: "user", content: "Recent user", status: "completed" },
      { role: "assistant", content: "Recent assistant", status: "completed" },
    ]);

    await expect(repository.listSessionHandoffsFrom(session.id)).resolves.toMatchObject([
      {
        fromSessionId: session.id,
        toSessionId: prepared!.session.id,
      },
    ]);

    database.sqlite.close();
  });

  it("skips compaction below the threshold", async () => {
    const compactionModule = (await import("../src/compactionEngine.js").catch(() => ({}))) as {
      createCompactionEngine?: (options: {
        contextLimitTokens: number;
        compactAtPercent: number;
        preserveLastTurns: number;
        estimateTokens: (input: { messages: Array<{ role: string; content: string }>; pendingUserMessage: string }) => number;
        summarize: (input: { messages: Array<{ role: string; content: string }> }) => Promise<string>;
      }) => {
        prepareConversation: (options: {
          repository: ChatRepository;
          session: { id: string };
          thread: { id: string };
          pendingUserMessage: string;
        }) => Promise<{ session: { id: string }; thread: { id: string }; compacted: boolean }>;
      };
    };

    expect(compactionModule.createCompactionEngine).toBeTypeOf("function");

    const database = createDatabase();
    const repository = new ChatRepository(database.db);
    const session = await repository.createSession("00000000-0000-4000-8000-000000000022");
    const thread = await repository.createThread(session.id);

    const engine = compactionModule.createCompactionEngine?.({
      contextLimitTokens: 100,
      compactAtPercent: 0.95,
      preserveLastTurns: 1,
      estimateTokens: () => 80,
      summarize: async () => "unused",
    });

    const prepared = await engine?.prepareConversation({
      repository,
      session,
      thread,
      pendingUserMessage: "Still small",
    });

    expect(prepared).toMatchObject({
      session: { id: session.id },
      thread: { id: thread.id },
      compacted: false,
    });
    await expect(repository.listSessionHandoffsFrom(session.id)).resolves.toEqual([]);

    database.sqlite.close();
  });

  it("falls back to the current session when summarization fails", async () => {
    const compactionModule = (await import("../src/compactionEngine.js").catch(() => ({}))) as {
      createCompactionEngine?: (options: {
        contextLimitTokens: number;
        compactAtPercent: number;
        preserveLastTurns: number;
        estimateTokens: (input: { messages: Array<{ role: string; content: string }>; pendingUserMessage: string }) => number;
        summarize: (input: { messages: Array<{ role: string; content: string }> }) => Promise<string>;
      }) => {
        prepareConversation: (options: {
          repository: ChatRepository;
          session: { id: string };
          thread: { id: string };
          pendingUserMessage: string;
        }) => Promise<{ session: { id: string }; thread: { id: string }; compacted: boolean }>;
      };
    };

    expect(compactionModule.createCompactionEngine).toBeTypeOf("function");

    const database = createDatabase();
    const repository = new ChatRepository(database.db);
    const session = await repository.createSession("00000000-0000-4000-8000-000000000023");
    const thread = await repository.createThread(session.id);
    await repository.createMessage({
      threadId: thread.id,
      role: "user",
      content: "Old user 1",
      status: "completed",
    });
    await repository.createMessage({
      threadId: thread.id,
      role: "assistant",
      content: "Old assistant 1",
      status: "completed",
    });
    await repository.createMessage({
      threadId: thread.id,
      role: "user",
      content: "Recent user",
      status: "completed",
    });
    await repository.createMessage({
      threadId: thread.id,
      role: "assistant",
      content: "Recent assistant",
      status: "completed",
    });

    const engine = compactionModule.createCompactionEngine?.({
      contextLimitTokens: 100,
      compactAtPercent: 0.95,
      preserveLastTurns: 1,
      estimateTokens: () => 96,
      summarize: async () => {
        throw new Error("summarizer offline");
      },
    });

    const prepared = await engine?.prepareConversation({
      repository,
      session,
      thread,
      pendingUserMessage: "Next prompt",
    });

    expect(prepared).toMatchObject({
      session: { id: session.id },
      thread: { id: thread.id },
      compacted: false,
    });
    await expect(repository.listSessionHandoffsFrom(session.id)).resolves.toEqual([]);

    database.sqlite.close();
  });
});
