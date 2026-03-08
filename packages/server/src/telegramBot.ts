import { compactionEngine, type CompactionEngine } from "./compactionEngine.js";
import type { ChatRepository } from "./repository.js";
import type { RunAgentOptions, ServerAgentMessage } from "./defaultAgentRunner.js";
import { loadTelegramConfig } from "./telegramConfig.js";

const DEFAULT_MAX_MESSAGE_LENGTH = 4096;
const DEFAULT_EDIT_INTERVAL_MS = 400;
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_PLACEHOLDER_TEXT = "...";
const HELP_CHAT_COMMAND = "/help";
const NEW_CHAT_COMMAND = "/new";
const STOP_CHAT_COMMAND = "/stop";
const HELP_MESSAGE =
  "Available commands:\n/new - Start a new chat.\n/stop - Stop the current activity.";
const STOPPING_MESSAGE = "Stopping current activity.";
const NOTHING_TO_STOP_MESSAGE = "Nothing is currently running.";
const STOPPED_REPLY_TEXT = "Stopped.";
const STOPPED_ERROR_MESSAGE = "Stopped by user.";

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
}

export interface TelegramPollingTransport extends TelegramTransport {
  getUpdates(
    offset: number,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>;
}

export interface TelegramStreamOptions {
  editIntervalMs?: number;
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

export async function handleTelegramMessage(options: HandleTelegramMessageOptions): Promise<void> {
  const text = options.text.trim();
  if (!text) {
    return;
  }

  if (text === NEW_CHAT_COMMAND) {
    await resetTelegramChatSession(options.repository, options.chatId);
    await options.telegram.sendMessage(options.chatId, "Started a new chat.");
    return;
  }

  if (text === HELP_CHAT_COMMAND) {
    await options.telegram.sendMessage(options.chatId, HELP_MESSAGE);
    return;
  }

  if (text === STOP_CHAT_COMMAND) {
    await options.telegram.sendMessage(options.chatId, NOTHING_TO_STOP_MESSAGE);
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

  const streamer = new TelegramReplyStreamer(options.telegram, options.chatId, options.streamOptions);
  await streamer.start();

  let assistantText = "";
  let hasCompletedEvent = false;
  let startedAt: string | null = null;
  let eventChain = Promise.resolve();
  const finalizeStoppedRun = async () => {
    const finalText = assistantText || STOPPED_REPLY_TEXT;
    await options.repository.updateMessage(assistantMessage.id, {
      content: finalText,
      status: "error",
    });
    await options.repository.updateRun(run.id, {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: STOPPED_ERROR_MESSAGE,
    });
    await streamer.complete(finalText);
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
            await streamer.append(event.delta);
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
            await streamer.complete(assistantText);
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
          await streamer.fail(assistantText || `Error: ${event.error}`);
        });

        return eventChain;
      },
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
      await streamer.complete(finalText);
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
    await streamer.fail(assistantText || `Error: ${message}`);
    throw error;
  } finally {
    await streamer.dispose();
  }
}

export async function startTelegramBot(
  options: StartTelegramBotOptions,
): Promise<{ close: () => Promise<void> } | null> {
  const telegram = options.telegram ?? (await createConfiguredTelegramClient());
  if (!telegram) {
    return null;
  }

  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
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

    if (update.text.trim() === STOP_CHAT_COMMAND) {
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
          agentRunner: (options) =>
            this.options.agentRunner({
              ...options,
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

    const messageText = hasActiveRun || droppedUpdates.length ? STOPPING_MESSAGE : NOTHING_TO_STOP_MESSAGE;
    await this.options.telegram.sendMessage(update.chatId, messageText);

    for (const droppedUpdate of droppedUpdates) {
      await this.options.repository.markTelegramUpdateHandled(droppedUpdate.chatId, droppedUpdate.updateId);
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

class TelegramReplyStreamer {
  private readonly editIntervalMs: number;
  private readonly maxMessageLength: number;
  private readonly placeholderText: string;
  private readonly messageIds: number[] = [];
  private readonly messageTexts: string[] = [];
  private readonly sentTexts: string[] = [];
  private readonly pendingEdits = new Set<Promise<void>>();
  private flushError: Error | undefined;
  private flushChain: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | undefined;
  private hasStarted = false;

  constructor(
    private readonly telegram: TelegramTransport,
    private readonly chatId: string,
    options: TelegramStreamOptions = {},
  ) {
    this.editIntervalMs = options.editIntervalMs ?? DEFAULT_EDIT_INTERVAL_MS;
    this.maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
    this.placeholderText = options.placeholderText ?? DEFAULT_PLACEHOLDER_TEXT;
  }

  async start() {
    if (this.hasStarted) {
      return;
    }

    const message = await this.telegram.sendMessage(this.chatId, this.placeholderText);
    this.messageIds.push(message.messageId);
    this.messageTexts.push("");
    this.sentTexts.push(this.placeholderText);
    this.hasStarted = true;
  }

  async append(delta: string) {
    this.throwIfFlushFailed();

    if (!delta) {
      return;
    }

    await this.start();
    this.appendToChunks(delta);
    await this.queueFlush(false);
  }

  async complete(text: string) {
    this.throwIfFlushFailed();
    await this.start();

    if (text && text !== this.messageTexts.join("")) {
      this.resetChunks(splitText(text, this.maxMessageLength));
    }

    await this.queueFlush(true);
  }

  async fail(text: string) {
    this.throwIfFlushFailed();

    if (text) {
      await this.complete(text);
      return;
    }

    await this.dispose();
  }

  async dispose() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.enqueueFlush();
    await Promise.all(this.pendingEdits);
    this.throwIfFlushFailed();
  }

  private appendToChunks(delta: string) {
    let remaining = delta;

    while (remaining) {
      const index = this.messageTexts.length - 1;
      const current = index >= 0 ? this.messageTexts[index] ?? "" : "";
      const available = this.maxMessageLength - current.length;

      if (available <= 0 || (current.length > 0 && remaining.length > available)) {
        this.messageTexts.push("");
        this.sentTexts.push("");
        continue;
      }

      const nextSlice = remaining.slice(0, available);
      if (index >= 0) {
        this.messageTexts[index] = `${current}${nextSlice}`;
      } else {
        this.messageTexts.push(nextSlice);
        this.sentTexts.push("");
      }
      remaining = remaining.slice(nextSlice.length);

      if (remaining && (this.messageTexts.at(-1)?.length ?? 0) >= this.maxMessageLength) {
        this.messageTexts.push("");
        this.sentTexts.push("");
      }
    }
  }

  private resetChunks(chunks: string[]) {
    this.messageTexts.length = 0;
    this.sentTexts.length = 0;

    for (const chunk of chunks) {
      this.messageTexts.push(chunk);
      this.sentTexts.push("");
    }

    if (!this.messageTexts.length) {
      this.messageTexts.push("");
      this.sentTexts.push("");
    }
  }

  private async queueFlush(force: boolean) {
    if (force || this.editIntervalMs <= 0) {
      await this.enqueueFlush();
      return;
    }

    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.enqueueFlush().catch((error: unknown) => {
        this.flushError = error instanceof Error ? error : new Error(String(error));
      });
    }, this.editIntervalMs);
  }

  private enqueueFlush() {
    const nextFlush = this.flushChain.catch(() => undefined).then(async () => {
      this.throwIfFlushFailed();
      await this.flush();
    });

    this.flushChain = nextFlush;
    return nextFlush;
  }

  private async flush() {
    await this.ensureMessageCount(this.messageTexts.length || 1);

    for (let index = 0; index < this.messageTexts.length; index += 1) {
      const nextText = this.messageTexts[index];
      if (!nextText || this.sentTexts[index] === nextText) {
        continue;
      }

      const editPromise = this.telegram
        .editMessageText(this.chatId, this.messageIds[index]!, nextText)
        .then(() => {
          this.sentTexts[index] = nextText;
        })
        .finally(() => {
          this.pendingEdits.delete(editPromise);
        });

      this.pendingEdits.add(editPromise);
      await editPromise;
    }
  }

  private async ensureMessageCount(count: number) {
    while (this.messageIds.length < count) {
      const message = await this.telegram.sendMessage(this.chatId, this.placeholderText);
      this.messageIds.push(message.messageId);
      if (this.sentTexts.length < this.messageIds.length) {
        this.sentTexts.push(this.placeholderText);
      }
    }
  }

  private throwIfFlushFailed() {
    if (this.flushError) {
      throw this.flushError;
    }
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
      const response = await postTelegram<TelegramApiResult<Array<{ update_id: number; message?: { chat?: { id?: number | string }; text?: string } }>>>(
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

function splitText(text: string, maxMessageLength: number) {
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxMessageLength));
    cursor += maxMessageLength;
  }

  return chunks;
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
