import type { AgentRunState } from "../../agent/src/runtime.js";
import type { TodoItem, TodoStatus } from "../../agent/src/todos/store.js";
import { compactionEngine, type CompactionEngine } from "./compactionEngine.js";
import {
  TELEGRAM_COMMANDS,
  TELEGRAM_MESSAGES,
  TELEGRAM_POLL_TIMEOUT_SECONDS,
  TELEGRAM_RETRY_DELAY_MS,
  TELEGRAM_STATUS_DELETE_DELAY_MS,
  TELEGRAM_WHIMSICAL_HEADLINES,
} from "./constants.js";
import type { ChatRepository } from "./repository.js";
import type { RunAgentOptions, ServerAgentMessage } from "./defaultAgentRunner.js";
import { loadTelegramConfig } from "./telegramConfig.js";

interface TelegramUpdate {
  updateId: number;
  chatId: string;
  text: string;
}

interface TelegramApiResult<T> {
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

type TelegramDisplayState =
  | "starting"
  | "planning"
  | "running tool"
  | "waiting for model"
  | "finalizing"
  | "completed"
  | "failed"
  | "stopped";

interface TelegramStatusSnapshot {
  headline: string;
  state: TelegramDisplayState;
  startedAtMs: number;
  toolName?: string;
  target?: string;
  lastToolName?: string;
  lastTarget?: string;
  todos: TodoItem[];
  error?: string;
}

export async function handleTelegramMessage(options: HandleTelegramMessageOptions): Promise<void> {
  const text = options.text.trim();
  if (!text) {
    return;
  }

  if (text === TELEGRAM_COMMANDS.new) {
    await resetTelegramChatSession(options.repository, options.chatId);
    await options.telegram.sendMessage(options.chatId, TELEGRAM_MESSAGES.startedNewChat);
    return;
  }

  if (text === TELEGRAM_COMMANDS.help) {
    await options.telegram.sendMessage(options.chatId, TELEGRAM_MESSAGES.help);
    return;
  }

  if (text === TELEGRAM_COMMANDS.stop) {
    await options.telegram.sendMessage(options.chatId, TELEGRAM_MESSAGES.nothingToStop);
    return;
  }

  const context = await getOrCreateTelegramThread(options.repository, options.chatId);
  const prepared = await (options.compactionEngine ?? compactionEngine).prepareConversation({
    repository: options.repository,
    session: context.session,
    thread: context.thread,
    pendingUserMessage: text,
  });

  if (prepared.session.id !== context.session.id) {
    await options.repository.setTelegramChatSession(options.chatId, prepared.session.id);
  }

  const userMessage = await options.repository.createMessage({
    threadId: prepared.thread.id,
    role: "user",
    content: text,
    status: "completed",
  });
  const assistantMessage = await options.repository.createMessage({
    threadId: prepared.thread.id,
    role: "assistant",
    content: "",
    status: "pending",
  });
  const run = await options.repository.createRun({
    threadId: prepared.thread.id,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
  });

  const statusSnapshot: TelegramStatusSnapshot = {
    headline: nextWhimsicalHeadline(),
    state: "starting",
    startedAtMs: Date.now(),
    todos: [],
  };
  const statusMessage = new TelegramStatusMessage(
    options.telegram,
    options.chatId,
    options.streamOptions?.completionDeleteDelayMs ?? TELEGRAM_STATUS_DELETE_DELAY_MS,
  );
  await statusMessage.start(renderTelegramStatus(statusSnapshot));

  let assistantText = "";
  let hasCompletedEvent = false;
  let hasSentFinalReply = false;
  let startedAt: string | null = null;
  let eventChain = Promise.resolve();

  const syncStatus = async () => {
    await statusMessage.update(renderTelegramStatus(statusSnapshot));
  };

  const sendFinalReply = async (finalText: string) => {
    if (hasSentFinalReply) {
      return;
    }

    hasSentFinalReply = true;
    await options.telegram.sendMessage(options.chatId, finalText);
    statusSnapshot.state = "completed";
    statusSnapshot.error = undefined;
    statusSnapshot.headline = nextWhimsicalHeadline();
    await syncStatus();
    statusMessage.deleteAfterDelay();
  };

  const finalizeStoppedRun = async () => {
    const finalText = assistantText || TELEGRAM_MESSAGES.stoppedReply;
    await options.repository.updateMessage(assistantMessage.id, {
      content: finalText,
      status: "error",
    });
    await options.repository.updateRun(run.id, {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: TELEGRAM_MESSAGES.stoppedError,
    });
    statusSnapshot.state = "stopped";
    statusSnapshot.error = TELEGRAM_MESSAGES.stoppedError;
    statusSnapshot.toolName ??= statusSnapshot.lastToolName;
    statusSnapshot.target ??= statusSnapshot.lastTarget;
    statusSnapshot.headline = nextWhimsicalHeadline();
    await syncStatus();
  };

  try {
    const threadMessages = await options.repository.listMessages(prepared.thread.id);

    const result = await options.agentRunner({
      sessionId: prepared.session.id,
      threadId: prepared.thread.id,
      messages: threadMessages
        .filter((message) => message.id !== assistantMessage.id)
        .filter((message) => message.role === "user" || message.status === "completed")
        .map<ServerAgentMessage>((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
          createdAt: message.createdAt,
        })),
      onEvent: (event) => {
        eventChain = eventChain.then(async () => {
          if (options.signal?.aborted) {
            return;
          }

          if (event.type === "run.started") {
            startedAt ??= new Date().toISOString();
            await options.repository.updateRun(run.id, {
              status: "streaming",
              startedAt,
              error: null,
            });
            return;
          }

          if (event.type === "run.state.changed") {
            statusSnapshot.state = mapRunState(event.state);
            statusSnapshot.headline = nextWhimsicalHeadline();
            await syncStatus();
            return;
          }

          if (event.type === "tool.started") {
            statusSnapshot.state = "running tool";
            statusSnapshot.toolName = event.toolName;
            statusSnapshot.target = extractTelegramTarget(event.args);
            statusSnapshot.lastToolName = statusSnapshot.toolName;
            statusSnapshot.lastTarget = statusSnapshot.target;
            statusSnapshot.error = undefined;
            statusSnapshot.headline = nextWhimsicalHeadline();
            await syncStatus();
            return;
          }

          if (event.type === "tool.completed") {
            statusSnapshot.state = "waiting for model";
            statusSnapshot.toolName = undefined;
            statusSnapshot.target = undefined;
            statusSnapshot.error = undefined;
            statusSnapshot.headline = nextWhimsicalHeadline();
            await syncStatus();
            return;
          }

          if (event.type === "todo.updated") {
            statusSnapshot.todos = event.todoDocument.todos;
            await syncStatus();
            return;
          }

          if (event.type === "message.delta") {
            startedAt ??= new Date().toISOString();
            assistantText += event.delta;
            await options.repository.updateMessage(assistantMessage.id, {
              content: assistantText,
              status: "streaming",
            });
            await options.repository.updateRun(run.id, {
              status: "streaming",
              startedAt,
              error: null,
            });

            if (statusSnapshot.state !== "finalizing") {
              statusSnapshot.state = "finalizing";
              statusSnapshot.headline = nextWhimsicalHeadline();
              await syncStatus();
            }
            return;
          }

          if (event.type === "message.completed") {
            hasCompletedEvent = true;
            startedAt ??= new Date().toISOString();
            assistantText = event.text;
            await options.repository.updateMessage(assistantMessage.id, {
              content: assistantText,
              status: "completed",
            });
            await options.repository.updateRun(run.id, {
              status: "completed",
              startedAt,
              finishedAt: new Date().toISOString(),
              error: null,
            });
            await sendFinalReply(assistantText);
            return;
          }

          await options.repository.updateMessage(assistantMessage.id, {
            content: assistantText,
            status: "error",
          });
          await options.repository.updateRun(run.id, {
            status: "failed",
            startedAt,
            finishedAt: new Date().toISOString(),
            error: event.error,
          });
          statusSnapshot.state = "failed";
          statusSnapshot.error = event.error;
          statusSnapshot.toolName ??= statusSnapshot.lastToolName;
          statusSnapshot.target ??= statusSnapshot.lastTarget;
          statusSnapshot.headline = nextWhimsicalHeadline();
          await syncStatus();
        });

        return eventChain;
      },
      signal: options.signal,
    });

    await eventChain;

    if (options.signal?.aborted) {
      startedAt ??= new Date().toISOString();
      await finalizeStoppedRun();
      return;
    }

    if (!hasCompletedEvent) {
      startedAt ??= new Date().toISOString();
      const finalText = assistantText || result.text;
      await options.repository.updateMessage(assistantMessage.id, {
        content: finalText,
        status: "completed",
      });
      await options.repository.updateRun(run.id, {
        status: "completed",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: null,
      });
      await sendFinalReply(finalText);
    }
  } catch (error: unknown) {
    startedAt ??= new Date().toISOString();

    if (options.signal?.aborted) {
      await finalizeStoppedRun();
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await options.repository.updateMessage(assistantMessage.id, {
      content: assistantText,
      status: "error",
    });
    await options.repository.updateRun(run.id, {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: message,
    });
    statusSnapshot.state = "failed";
    statusSnapshot.error = message;
    statusSnapshot.toolName ??= statusSnapshot.lastToolName;
    statusSnapshot.target ??= statusSnapshot.lastTarget;
    statusSnapshot.headline = nextWhimsicalHeadline();
    await syncStatus();
    throw error;
  } finally {
    await statusMessage.dispose();
  }
}

export async function startTelegramBot(
  options: StartTelegramBotOptions,
): Promise<{ close: () => Promise<void> } | null> {
  const telegram = options.telegram ?? (await createConfiguredTelegramClient());
  if (!telegram) {
    return null;
  }

  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? TELEGRAM_POLL_TIMEOUT_SECONDS;
  const retryDelayMs = options.retryDelayMs ?? TELEGRAM_RETRY_DELAY_MS;
  let isClosed = false;
  let updateOffset = 0;
  let activePollController: AbortController | undefined;
  const updateCoordinator = new TelegramUpdateCoordinator({
    repository: options.repository,
    agentRunner: options.agentRunner,
    compactionEngine: options.compactionEngine,
    telegram,
  });

  const loop = (async () => {
    while (!isClosed) {
      try {
        activePollController = new AbortController();
        const updates = await telegram.getUpdates(
          updateOffset,
          pollTimeoutSeconds,
          activePollController.signal,
        );
        activePollController = undefined;

        for (const update of updates) {
          if (update.updateId < updateOffset) {
            continue;
          }

          updateOffset = Math.max(updateOffset, update.updateId + 1);
          const chatSession = await options.repository.getTelegramChatSession(update.chatId);
          if (
            chatSession?.lastUpdateId !== null &&
            chatSession?.lastUpdateId !== undefined &&
            update.updateId <= chatSession.lastUpdateId
          ) {
            continue;
          }

          updateCoordinator.dispatch(update);
        }
      } catch (error) {
        activePollController = undefined;
        if (isClosed) {
          return;
        }

        console.error("Telegram polling failed", error);
        await delay(retryDelayMs);
      }
    }
  })();

  return {
    close: async () => {
      isClosed = true;
      activePollController?.abort();
      await updateCoordinator.close();
      await loop;
    },
  };
}

interface TelegramUpdateCoordinatorOptions {
  repository: ChatRepository;
  agentRunner: (options: RunAgentOptions) => Promise<{ text: string }>;
  compactionEngine?: CompactionEngine;
  telegram: TelegramPollingTransport;
}

interface TelegramChatState {
  processing: boolean;
  queue: TelegramUpdate[];
  activeRun?: {
    abortController: AbortController;
  };
}

class TelegramUpdateCoordinator {
  private readonly chatStates = new Map<string, TelegramChatState>();
  private readonly pendingTasks = new Set<Promise<void>>();
  private isClosed = false;

  constructor(private readonly options: TelegramUpdateCoordinatorOptions) {}

  dispatch(update: TelegramUpdate) {
    if (this.isClosed) {
      return;
    }

    if (update.text.trim() === TELEGRAM_COMMANDS.stop) {
      this.trackTask(this.handleStopCommand(update));
      return;
    }

    const state = this.getOrCreateState(update.chatId);
    state.queue.push(update);
    this.ensureProcessing(update.chatId);
  }

  async close() {
    this.isClosed = true;

    for (const state of this.chatStates.values()) {
      state.queue.length = 0;
      state.activeRun?.abortController.abort();
    }

    await Promise.allSettled([...this.pendingTasks]);
  }

  private ensureProcessing(chatId: string) {
    const state = this.getOrCreateState(chatId);
    if (state.processing) {
      return;
    }

    state.processing = true;
    this.trackTask(
      this.processChat(chatId).finally(() => {
        const latestState = this.chatStates.get(chatId);
        if (!latestState) {
          return;
        }

        latestState.processing = false;
        if (!this.isClosed && latestState.queue.length > 0) {
          this.ensureProcessing(chatId);
          return;
        }

        this.cleanupState(chatId);
      }),
    );
  }

  private async processChat(chatId: string) {
    const state = this.getOrCreateState(chatId);

    while (!this.isClosed && state.queue.length > 0) {
      const update = state.queue.shift();
      if (!update) {
        return;
      }

      const abortController = new AbortController();
      state.activeRun = { abortController };

      try {
        await handleTelegramMessage({
          chatId: update.chatId,
          text: update.text,
          repository: this.options.repository,
          agentRunner: (agentOptions) =>
            this.options.agentRunner({
              ...agentOptions,
              signal: abortController.signal,
            }),
          telegram: this.options.telegram,
          compactionEngine: this.options.compactionEngine,
          signal: abortController.signal,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Telegram update handling failed", error);
        }
      } finally {
        if (state.activeRun?.abortController === abortController) {
          state.activeRun = undefined;
        }

        await this.options.repository.markTelegramUpdateHandled(update.chatId, update.updateId);
      }
    }
  }

  private async handleStopCommand(update: TelegramUpdate) {
    const state = this.getOrCreateState(update.chatId);
    const droppedUpdates = state.queue.splice(0);
    const hasActiveRun = Boolean(state.activeRun);

    state.activeRun?.abortController.abort();

    const messageText =
      hasActiveRun || droppedUpdates.length
        ? TELEGRAM_MESSAGES.stopping
        : TELEGRAM_MESSAGES.nothingToStop;
    await this.options.telegram.sendMessage(update.chatId, messageText);

    for (const droppedUpdate of droppedUpdates) {
      await this.options.repository.markTelegramUpdateHandled(
        droppedUpdate.chatId,
        droppedUpdate.updateId,
      );
    }

    await this.options.repository.markTelegramUpdateHandled(update.chatId, update.updateId);
    this.cleanupState(update.chatId);
  }

  private getOrCreateState(chatId: string) {
    let state = this.chatStates.get(chatId);
    if (!state) {
      state = {
        processing: false,
        queue: [],
      };
      this.chatStates.set(chatId, state);
    }
    return state;
  }

  private cleanupState(chatId: string) {
    const state = this.chatStates.get(chatId);
    if (!state || state.processing || state.activeRun || state.queue.length > 0) {
      return;
    }

    this.chatStates.delete(chatId);
  }

  private trackTask(task: Promise<void>) {
    const trackedTask = task
      .catch((error) => {
        if (!this.isClosed) {
          console.error("Telegram coordination failed", error);
        }
      })
      .finally(() => {
        this.pendingTasks.delete(trackedTask);
      });

    this.pendingTasks.add(trackedTask);
  }
}

class TelegramStatusMessage {
  private messageId: number | undefined;
  private lastText = "";
  private deleteTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly telegram: TelegramTransport,
    private readonly chatId: string,
    private readonly deleteDelayMs: number,
  ) {}

  async start(text: string) {
    if (this.messageId !== undefined) {
      return;
    }

    const message = await this.telegram.sendMessage(this.chatId, text);
    this.messageId = message.messageId;
    this.lastText = text;
  }

  async update(text: string) {
    await this.start(text);
    if (this.messageId === undefined || this.lastText === text) {
      return;
    }

    await this.telegram.editMessageText(this.chatId, this.messageId, text);
    this.lastText = text;
  }

  deleteAfterDelay() {
    if (this.messageId === undefined) {
      return;
    }

    if (this.deleteTimer) {
      clearTimeout(this.deleteTimer);
    }

    this.deleteTimer = setTimeout(() => {
      void this.deleteNow().catch((error) => {
        console.error("Telegram status cleanup failed", error);
      });
    }, this.deleteDelayMs);
  }

  async dispose() {
    if (this.deleteTimer) {
      return;
    }
  }

  private async deleteNow() {
    if (this.deleteTimer) {
      clearTimeout(this.deleteTimer);
      this.deleteTimer = undefined;
    }

    if (this.messageId === undefined) {
      return;
    }

    const messageId = this.messageId;
    this.messageId = undefined;
    await this.telegram.deleteMessage(this.chatId, messageId);
  }
}

async function createConfiguredTelegramClient(): Promise<TelegramPollingTransport | null> {
  const config = await loadTelegramConfig();
  if (!config) {
    return null;
  }

  return createTelegramClient(config.botToken);
}

function createTelegramClient(botToken: string): TelegramPollingTransport {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;

  return {
    async getUpdates(offset, timeoutSeconds, signal) {
      const response = await postTelegram<
        TelegramApiResult<Array<{ update_id: number; message?: { chat?: { id?: number | string }; text?: string } }>>
      >(
        `${baseUrl}/getUpdates`,
        {
          offset,
          timeout: timeoutSeconds,
          allowed_updates: ["message"],
        },
        signal,
      );

      return response.result
        .map((update) => {
          const text = update.message?.text?.trim();
          const chatId = update.message?.chat?.id;

          if (!text || chatId === undefined) {
            return null;
          }

          return {
            updateId: update.update_id,
            chatId: String(chatId),
            text,
          };
        })
        .filter((update): update is TelegramUpdate => update !== null);
    },
    async sendMessage(chatId, text) {
      const response = await postTelegram<TelegramApiResult<{ message_id: number }>>(
        `${baseUrl}/sendMessage`,
        {
          chat_id: chatId,
          text,
        },
      );

      return {
        messageId: response.result.message_id,
      };
    },
    async editMessageText(chatId, messageId, text) {
      await postTelegram(`${baseUrl}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text,
      });
    },
    async deleteMessage(chatId, messageId) {
      await postTelegram(`${baseUrl}/deleteMessage`, {
        chat_id: chatId,
        message_id: messageId,
      });
    },
  };
}

async function getOrCreateTelegramThread(repository: ChatRepository, chatId: string) {
  const mapping = await repository.getTelegramChatSession(chatId);
  let session = mapping ? await repository.getSession(mapping.sessionId) : undefined;

  if (!session) {
    session = await repository.createSession();
    await repository.setTelegramChatSession(chatId, session.id);
  }

  let thread = session.lastThreadId
    ? await repository.getThreadForSession(session.lastThreadId, session.id)
    : undefined;

  if (!thread) {
    thread = await repository.createThread(session.id);
  }

  return { session, thread };
}

async function resetTelegramChatSession(repository: ChatRepository, chatId: string) {
  const session = await repository.createSession();
  const thread = await repository.createThread(session.id);
  await repository.setTelegramChatSession(chatId, session.id);
  return { session, thread };
}

async function postTelegram<T>(
  url: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Telegram API request failed with status ${response.status}`);
  }

  const responsePayload = (await response.json()) as TelegramApiResult<T> | T;
  if (
    typeof responsePayload === "object" &&
    responsePayload !== null &&
    "ok" in responsePayload &&
    responsePayload.ok === false
  ) {
    throw new Error(responsePayload.description ?? "Telegram API request failed");
  }

  return responsePayload as T;
}

function renderTelegramStatus(snapshot: TelegramStatusSnapshot) {
  const lines = [snapshot.headline, `State: ${snapshot.state}`];
  const toolName = snapshot.toolName ?? (isRetainedState(snapshot.state) ? snapshot.lastToolName : undefined);
  const target = snapshot.target ?? (isRetainedState(snapshot.state) ? snapshot.lastTarget : undefined);

  if (toolName) {
    lines.push(`Tool: ${toolName}`);
  }

  if (target) {
    lines.push(`Target: ${target}`);
  }

  if (snapshot.todos.length > 0) {
    lines.push("Todos:");
    for (const todo of snapshot.todos) {
      lines.push(`${todoStatusEmoji(todo.status)} ${todo.text}`);
    }
  }

  if (snapshot.error) {
    lines.push(`Error: ${snapshot.error}`);
  }

  lines.push(`Elapsed: ${formatElapsed(Date.now() - snapshot.startedAtMs)}`);
  return lines.join("\n");
}

function mapRunState(state: AgentRunState): TelegramDisplayState {
  switch (state) {
    case "planning":
      return "planning";
    case "running_tool":
      return "running tool";
    case "waiting_for_model":
      return "waiting for model";
    case "finalizing":
      return "finalizing";
  }
}

function extractTelegramTarget(args: unknown) {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  const candidate = args as Record<string, unknown>;
  for (const key of ["path", "command", "name", "pattern", "query", "glob"]) {
    if (typeof candidate[key] === "string" && candidate[key]) {
      return candidate[key] as string;
    }
  }

  return undefined;
}

function todoStatusEmoji(status: TodoStatus) {
  switch (status) {
    case "pending":
      return "⏳";
    case "in_progress":
      return "🔧";
    case "done":
      return "✅";
    case "blocked":
      return "🚫";
  }
}

function nextWhimsicalHeadline() {
  return TELEGRAM_WHIMSICAL_HEADLINES[
    Math.floor(Math.random() * TELEGRAM_WHIMSICAL_HEADLINES.length)
  ]!;
}

function isRetainedState(state: TelegramDisplayState) {
  return state === "failed" || state === "stopped";
}

function formatElapsed(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
