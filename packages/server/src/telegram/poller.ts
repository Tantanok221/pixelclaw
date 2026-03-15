import {
  TELEGRAM_BOT_COMMANDS,
  TELEGRAM_POLL_TIMEOUT_SECONDS,
  TELEGRAM_RETRY_DELAY_MS,
} from "../constants.js";
import { createConfiguredTelegramClient } from "./client.js";
import type { StartTelegramBotOptions } from "./types.js";
import { TelegramUpdateCoordinator } from "./updateCoordinator.js";

export async function startTelegramBot(
  options: StartTelegramBotOptions,
): Promise<{ close: () => Promise<void> } | null> {
  const telegram = options.telegram ?? (await createConfiguredTelegramClient());
  if (!telegram) {
    return null;
  }

  await telegram.setMyCommands?.([...TELEGRAM_BOT_COMMANDS]);

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

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
