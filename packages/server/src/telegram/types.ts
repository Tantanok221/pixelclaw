import type { TodoItem } from "../../../agent/src/todos/store.js";
import type { CompactionEngine } from "../compactionEngine.js";
import type { RunAgentOptions } from "../defaultAgentRunner.js";
import type { ChatRepository } from "../repository.js";

export interface TelegramUpdate {
  updateId: number;
  chatId: string;
  text: string;
}

export interface TelegramApiResult<T> {
  ok: boolean;
  result: T;
  description?: string;
}

export interface TelegramTransport {
  sendMessage(chatId: string, text: string): Promise<{ messageId: number }>;
  editMessageText(chatId: string, messageId: number, text: string): Promise<void>;
  deleteMessage(chatId: string, messageId: number): Promise<void>;
}

export interface TelegramPollingTransport extends TelegramTransport {
  getUpdates(
    offset: number,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>;
}

export interface TelegramStreamOptions {
  completionDeleteDelayMs?: number;
  editIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxMessageLength?: number;
  placeholderText?: string;
}

export interface HandleTelegramMessageOptions {
  chatId: string;
  text: string;
  repository: ChatRepository;
  agentRunner: (options: RunAgentOptions) => Promise<{ text: string }>;
  telegram: TelegramTransport;
  compactionEngine?: CompactionEngine;
  streamOptions?: TelegramStreamOptions;
  signal?: AbortSignal;
}

export interface StartTelegramBotOptions {
  repository: ChatRepository;
  agentRunner: (options: RunAgentOptions) => Promise<{ text: string }>;
  compactionEngine?: CompactionEngine;
  telegram?: TelegramPollingTransport;
  pollTimeoutSeconds?: number;
  retryDelayMs?: number;
}

export type TelegramDisplayState =
  | "starting"
  | "planning"
  | "running tool"
  | "waiting for model"
  | "finalizing"
  | "completed"
  | "failed"
  | "stopped";

export interface TelegramStatusSnapshot {
  headline: string;
  state: TelegramDisplayState;
  startedAtMs: number;
  lastHeadlineUpdatedAtMs: number;
  toolName?: string;
  target?: string;
  lastToolName?: string;
  lastTarget?: string;
  todos: TodoItem[];
  error?: string;
}
