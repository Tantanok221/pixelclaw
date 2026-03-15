import { compactionEngine } from "../compactionEngine.js";
import {
  TELEGRAM_MESSAGES,
  TELEGRAM_STATUS_DELETE_DELAY_MS,
  TELEGRAM_WHIMSICAL_HEADLINE_UPDATE_INTERVAL_MS,
} from "../constants.js";
import type { ServerAgentMessage } from "../defaultAgentRunner.js";
import { tryHandleTelegramCommand } from "./commands.js";
import { TelegramEditableMessage, TelegramStatusMessage } from "./messages.js";
import { ensureTelegramUserPairing } from "./pairing.js";
import { getOrCreateTelegramThread } from "./session.js";
import {
  clampTelegramReplyText,
  extractTelegramTarget,
  mapRunState,
  nextWhimsicalHeadline,
  renderTelegramStatus,
  resolveReplyPlaceholderText,
} from "./statusFormatting.js";
import type { HandleTelegramMessageOptions, TelegramStatusSnapshot } from "./types.js";

export async function handleTelegramMessage(options: HandleTelegramMessageOptions): Promise<void> {
  const text = options.text.trim();
  if (!text) {
    return;
  }

  if (
    !(await ensureTelegramUserPairing({
      chatId: options.chatId,
      userId: options.userId,
      repository: options.repository,
      telegram: options.telegram,
    }))
  ) {
    return;
  }

  if (
    await tryHandleTelegramCommand({
      chatId: options.chatId,
      text,
      repository: options.repository,
      telegram: options.telegram,
    })
  ) {
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
    source: "telegram",
  });
  await options.repository.createRunEvent({
    runId: run.id,
    threadId: prepared.thread.id,
    sessionId: prepared.session.id,
    source: "telegram",
    type: "run.created",
    payload: {
      assistantMessageId: assistantMessage.id,
      userMessageId: userMessage.id,
    },
  });

  const statusStartedAtMs = Date.now();
  const statusSnapshot: TelegramStatusSnapshot = {
    headline: nextWhimsicalHeadline(),
    state: "starting",
    startedAtMs: statusStartedAtMs,
    lastHeadlineUpdatedAtMs: statusStartedAtMs,
    todos: [],
  };
  const statusMessage = new TelegramStatusMessage(
    options.telegram,
    options.chatId,
    options.streamOptions?.completionDeleteDelayMs ?? TELEGRAM_STATUS_DELETE_DELAY_MS,
  );
  const replyMessage = new TelegramEditableMessage(options.telegram, options.chatId);
  const replyEditIntervalMs = options.streamOptions?.editIntervalMs ?? 750;
  const replyMaxMessageLength = options.streamOptions?.maxMessageLength ?? 4000;
  await statusMessage.start(renderTelegramStatus(statusSnapshot));
  await replyMessage.start(resolveReplyPlaceholderText(options.streamOptions?.placeholderText));
  let lastReplyEditAtMs = Date.now();

  let assistantText = "";
  let hasCompletedEvent = false;
  let hasFailedEvent = false;
  let hasSentFinalReply = false;
  let startedAt: string | null = null;
  let eventChain = Promise.resolve();

  const updateHeadline = (force = false) => {
    const now = Date.now();
    if (
      force ||
      now - statusSnapshot.lastHeadlineUpdatedAtMs >=
        TELEGRAM_WHIMSICAL_HEADLINE_UPDATE_INTERVAL_MS
    ) {
      statusSnapshot.headline = nextWhimsicalHeadline();
      statusSnapshot.lastHeadlineUpdatedAtMs = now;
    }
  };

  const syncStatus = async () => {
    await statusMessage.update(renderTelegramStatus(statusSnapshot));
  };

  const syncReply = async (replyText: string, force = false) => {
    const renderedText = clampTelegramReplyText(replyText, replyMaxMessageLength);
    const now = Date.now();
    if (!force && now - lastReplyEditAtMs < replyEditIntervalMs) {
      return;
    }

    await replyMessage.update(renderedText);
    lastReplyEditAtMs = now;
  };

  const sendFinalReply = async (finalText: string) => {
    if (hasSentFinalReply) {
      return;
    }

    hasSentFinalReply = true;
    await syncReply(finalText, true);
    statusSnapshot.state = "completed";
    statusSnapshot.error = undefined;
    updateHeadline(true);
    await syncStatus();
    statusMessage.deleteAfterDelay();
  };

  const finalizeStoppedRun = async () => {
    const finalText = assistantText || TELEGRAM_MESSAGES.stoppedReply;
    await syncReply(finalText, true);
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
    await options.repository.createRunEvent({
      runId: run.id,
      threadId: prepared.thread.id,
      sessionId: prepared.session.id,
      source: "telegram",
      type: "run.failed",
      payload: { error: TELEGRAM_MESSAGES.stoppedError },
    });
    statusSnapshot.state = "stopped";
    statusSnapshot.error = TELEGRAM_MESSAGES.stoppedError;
    statusSnapshot.toolName ??= statusSnapshot.lastToolName;
    statusSnapshot.target ??= statusSnapshot.lastTarget;
    updateHeadline(true);
    await syncStatus();
  };

  try {
    const threadMessages = await options.repository.listMessages(prepared.thread.id);

    const result = await options.agentRunner({
      sessionId: prepared.session.id,
      threadId: prepared.thread.id,
      mode: context.mode,
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
            await options.repository.createRunEvent({
              runId: run.id,
              threadId: prepared.thread.id,
              sessionId: prepared.session.id,
              source: "telegram",
              type: event.type,
            });
            return;
          }

          if (event.type === "run.state.changed") {
            statusSnapshot.state = mapRunState(event.state);
            await options.repository.createRunEvent({
              runId: run.id,
              threadId: prepared.thread.id,
              sessionId: prepared.session.id,
              source: "telegram",
              type: event.type,
              payload: { state: event.state },
            });
            updateHeadline();
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
            await options.repository.createRunEvent({
              runId: run.id,
              threadId: prepared.thread.id,
              sessionId: prepared.session.id,
              source: "telegram",
              type: event.type,
              payload: {
                toolName: event.toolName,
                args: event.args,
              },
            });
            updateHeadline();
            await syncStatus();
            return;
          }

          if (event.type === "tool.completed") {
            statusSnapshot.state = "waiting for model";
            statusSnapshot.toolName = undefined;
            statusSnapshot.target = undefined;
            statusSnapshot.error = undefined;
            await options.repository.createRunEvent({
              runId: run.id,
              threadId: prepared.thread.id,
              sessionId: prepared.session.id,
              source: "telegram",
              type: event.type,
              payload: {
                toolName: event.toolName,
                args: event.args,
                isError: event.isError,
              },
            });
            updateHeadline();
            await syncStatus();
            return;
          }

          if (event.type === "todo.updated") {
            statusSnapshot.todos = event.todoDocument.todos;
            await options.repository.createRunEvent({
              runId: run.id,
              threadId: prepared.thread.id,
              sessionId: prepared.session.id,
              source: "telegram",
              type: event.type,
              payload: event.todoDocument,
            });
            await syncStatus();
            return;
          }

          if (event.type === "message.delta") {
            startedAt ??= new Date().toISOString();
            assistantText += event.delta;
            await syncReply(assistantText);
            await options.repository.updateMessage(assistantMessage.id, {
              content: assistantText,
              status: "streaming",
            });
            await options.repository.updateRun(run.id, {
              status: "streaming",
              startedAt,
              error: null,
            });
            await options.repository.createRunEvent({
              runId: run.id,
              threadId: prepared.thread.id,
              sessionId: prepared.session.id,
              source: "telegram",
              type: event.type,
              payload: { delta: event.delta },
            });

            if (statusSnapshot.state !== "finalizing") {
              statusSnapshot.state = "finalizing";
              updateHeadline(true);
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
            await options.repository.createRunEvent({
              runId: run.id,
              threadId: prepared.thread.id,
              sessionId: prepared.session.id,
              source: "telegram",
              type: event.type,
              payload: { text: assistantText },
            });
            await sendFinalReply(assistantText);
            return;
          }

          await options.repository.updateMessage(assistantMessage.id, {
            content: assistantText,
            status: "error",
          });
          await syncReply(assistantText || `Error: ${event.error}`, true);
          await options.repository.updateRun(run.id, {
            status: "failed",
            startedAt,
            finishedAt: new Date().toISOString(),
            error: event.error,
          });
          hasFailedEvent = true;
          await options.repository.createRunEvent({
            runId: run.id,
            threadId: prepared.thread.id,
            sessionId: prepared.session.id,
            source: "telegram",
            type: event.type,
            payload: { error: event.error },
          });
          statusSnapshot.state = "failed";
          statusSnapshot.error = event.error;
          statusSnapshot.toolName ??= statusSnapshot.lastToolName;
          statusSnapshot.target ??= statusSnapshot.lastTarget;
          updateHeadline(true);
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

    if (!hasCompletedEvent && !hasFailedEvent) {
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
      await options.repository.createRunEvent({
        runId: run.id,
        threadId: prepared.thread.id,
        sessionId: prepared.session.id,
        source: "telegram",
        type: "message.completed",
        payload: { text: finalText },
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
    try {
      await syncReply(assistantText || `Error: ${message}`, true);
    } catch {}
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
    await options.repository.createRunEvent({
      runId: run.id,
      threadId: prepared.thread.id,
      sessionId: prepared.session.id,
      source: "telegram",
      type: "run.failed",
      payload: { error: message },
    });
    statusSnapshot.state = "failed";
    statusSnapshot.error = message;
    statusSnapshot.toolName ??= statusSnapshot.lastToolName;
    statusSnapshot.target ??= statusSnapshot.lastTarget;
    updateHeadline(true);
    await syncStatus();
    throw error;
  } finally {
    await statusMessage.dispose();
  }
}
