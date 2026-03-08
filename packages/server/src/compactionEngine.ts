import { runCompactionSummary } from "../../agent/src/compaction.js";
import {
  COMPACTION_CONTEXT_LIMIT_TOKENS,
  COMPACTION_PRESERVE_LAST_TURNS,
  COMPACTION_TRIGGER_PERCENT,
  ESTIMATED_MESSAGE_OVERHEAD_TOKENS,
  ESTIMATED_SYSTEM_PROMPT_TOKENS,
} from "./constants.js";
import type { ChatRepository } from "./repository.js";
import type { SessionRow, ThreadRow } from "./schema.js";

export interface CompactionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PrepareConversationOptions {
  repository: ChatRepository;
  session: SessionRow;
  thread: ThreadRow;
  pendingUserMessage: string;
}

export interface PreparedConversation {
  session: SessionRow;
  thread: ThreadRow;
  compacted: boolean;
}

export interface CompactionEngine {
  prepareConversation(options: PrepareConversationOptions): Promise<PreparedConversation>;
}

export interface CreateCompactionEngineOptions {
  contextLimitTokens: number;
  compactAtPercent: number;
  preserveLastTurns: number;
  estimateTokens: (input: {
    messages: CompactionMessage[];
    pendingUserMessage: string;
  }) => number;
  summarize: (input: { messages: CompactionMessage[] }) => Promise<string>;
}

export function createCompactionEngine(options: CreateCompactionEngineOptions): CompactionEngine {
  return {
    async prepareConversation(input) {
      const existingMessages = (await input.repository.listMessages(input.thread.id))
        .filter((message) => message.role === "user" || message.status === "completed")
        .map<CompactionMessage>((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        }));

      const estimatedTokens = options.estimateTokens({
        messages: existingMessages,
        pendingUserMessage: input.pendingUserMessage,
      });
      const compactAtTokens = Math.floor(options.contextLimitTokens * options.compactAtPercent);

      if (estimatedTokens < compactAtTokens) {
        return {
          session: input.session,
          thread: input.thread,
          compacted: false,
        };
      }

      const preservedStartIndex = findPreservedStartIndex(
        existingMessages,
        options.preserveLastTurns,
      );

      if (preservedStartIndex <= 0) {
        return {
          session: input.session,
          thread: input.thread,
          compacted: false,
        };
      }

      const compactedMessages = existingMessages.slice(0, preservedStartIndex);
      const preservedMessages = existingMessages.slice(preservedStartIndex);

      try {
        const summary = await options.summarize({
          messages: compactedMessages,
        });

        const nextSession = await input.repository.createSession();
        const nextThread = await input.repository.createThread(nextSession.id);
        const summaryMessage = await input.repository.createMessage({
          threadId: nextThread.id,
          role: "assistant",
          content: summary,
          status: "completed",
        });

        for (const message of preservedMessages) {
          await input.repository.createMessage({
            threadId: nextThread.id,
            role: message.role,
            content: message.content,
            status: "completed",
          });
        }

        await input.repository.createSessionHandoff({
          fromSessionId: input.session.id,
          toSessionId: nextSession.id,
          summaryMessageId: summaryMessage.id,
        });

        return {
          session: nextSession,
          thread: nextThread,
          compacted: true,
        };
      } catch {
        return {
          session: input.session,
          thread: input.thread,
          compacted: false,
        };
      }
    },
  };
}

export const compactionEngine = createCompactionEngine({
  contextLimitTokens: COMPACTION_CONTEXT_LIMIT_TOKENS,
  compactAtPercent: COMPACTION_TRIGGER_PERCENT,
  preserveLastTurns: COMPACTION_PRESERVE_LAST_TURNS,
  estimateTokens: estimateConversationTokens,
  summarize: async ({ messages }) => runCompactionSummary(messages),
});

export function estimateConversationTokens(input: {
  messages: CompactionMessage[];
  pendingUserMessage: string;
}) {
  const messageTokens = input.messages.reduce((total, message) => {
    return total + estimateTextTokens(message.content) + ESTIMATED_MESSAGE_OVERHEAD_TOKENS;
  }, 0);

  return (
    ESTIMATED_SYSTEM_PROMPT_TOKENS +
    messageTokens +
    estimateTextTokens(input.pendingUserMessage) +
    ESTIMATED_MESSAGE_OVERHEAD_TOKENS
  );
}

function estimateTextTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function findPreservedStartIndex(messages: CompactionMessage[], preserveLastTurns: number) {
  const userMessageIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );

  if (userMessageIndexes.length <= preserveLastTurns) {
    return 0;
  }

  return userMessageIndexes[userMessageIndexes.length - preserveLastTurns] ?? 0;
}
