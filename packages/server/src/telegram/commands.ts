import { TELEGRAM_COMMANDS, TELEGRAM_MESSAGES } from "../constants.js";
import type { ChatRepository } from "../repository.js";
import { resetTelegramChatSession } from "./session.js";
import type { TelegramTransport } from "./types.js";

interface TryHandleTelegramCommandOptions {
  chatId: string;
  text: string;
  repository: ChatRepository;
  telegram: TelegramTransport;
}

export async function tryHandleTelegramCommand(
  options: TryHandleTelegramCommandOptions,
): Promise<boolean> {
  if (options.text === TELEGRAM_COMMANDS.new) {
    await resetTelegramChatSession(options.repository, options.chatId);
    await options.telegram.sendMessage(options.chatId, TELEGRAM_MESSAGES.startedNewChat);
    return true;
  }

  if (options.text === TELEGRAM_COMMANDS.help) {
    await options.telegram.sendMessage(options.chatId, TELEGRAM_MESSAGES.help);
    return true;
  }

  if (isTelegramParaphraseToggleCommand(options.text)) {
    const paraphraseEnabled = await options.repository.toggleTelegramChatParaphrase(options.chatId);
    await options.telegram.sendMessage(
      options.chatId,
      paraphraseEnabled
        ? TELEGRAM_MESSAGES.paraphraseEnabled
        : TELEGRAM_MESSAGES.paraphraseDisabled,
    );
    return true;
  }

  if (
    options.text.startsWith(`${TELEGRAM_COMMANDS.toggle} `) ||
    options.text === TELEGRAM_COMMANDS.toggle
  ) {
    await options.telegram.sendMessage(options.chatId, TELEGRAM_MESSAGES.invalidToggle);
    return true;
  }

  if (options.text === TELEGRAM_COMMANDS.stop) {
    await options.telegram.sendMessage(options.chatId, TELEGRAM_MESSAGES.nothingToStop);
    return true;
  }

  return false;
}

function isTelegramParaphraseToggleCommand(text: string): boolean {
  return /^\/toggle\s+(paraphrase|paraphase)$/i.test(text.trim());
}
