import { TELEGRAM_COMMANDS, TELEGRAM_MESSAGES } from "../constants.js";
import type { CompactionEngine } from "../compactionEngine.js";
import type { RunAgentOptions } from "../defaultAgentRunner.js";
import type { ChatRepository } from "../repository.js";
import { handleTelegramMessage } from "./conversationRunner.js";
import { ensureTelegramUserPairing } from "./pairing.js";
import type { TelegramPollingTransport, TelegramUpdate } from "./types.js";

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

export class TelegramUpdateCoordinator {
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
          userId: update.userId,
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
    if (
      !(await ensureTelegramUserPairing({
        chatId: update.chatId,
        userId: update.userId,
        repository: this.options.repository,
        telegram: this.options.telegram,
      }))
    ) {
      await this.options.repository.markTelegramUpdateHandled(update.chatId, update.updateId);
      return;
    }

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
