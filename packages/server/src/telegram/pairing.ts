import { randomUUID } from "node:crypto";
import { TELEGRAM_PAIRING_CODE_TTL_MS } from "../constants.js";
import type { ChatRepository } from "../repository.js";
import type { TelegramTransport } from "./types.js";

export const TELEGRAM_PAIRING_COMMAND_PREFIX = "npm run pair:telegram --";

interface EnsureTelegramUserPairingOptions {
  chatId: string;
  userId: string;
  repository: ChatRepository;
  telegram: TelegramTransport;
}

export async function ensureTelegramUserPairing(
  options: EnsureTelegramUserPairingOptions,
): Promise<boolean> {
  const existing = await options.repository.getTelegramUserAccess(options.userId);
  if (existing?.isAuthorized) {
    return true;
  }

  const now = Date.now();
  let pairingCode = existing?.pairingCode;
  let pairingCodeExpiresAt = existing?.pairingCodeExpiresAt;

  if (
    !pairingCode ||
    !pairingCodeExpiresAt ||
    Number.isNaN(Date.parse(pairingCodeExpiresAt)) ||
    Date.parse(pairingCodeExpiresAt) <= now
  ) {
    pairingCode = createTelegramPairingCode();
    pairingCodeExpiresAt = new Date(now + TELEGRAM_PAIRING_CODE_TTL_MS).toISOString();
    await options.repository.saveTelegramPairingCode(
      options.userId,
      pairingCode,
      pairingCodeExpiresAt,
    );
  }

  await options.telegram.sendMessage(options.chatId, renderTelegramPairingMessage(pairingCode));
  return false;
}

export function renderTelegramPairingMessage(pairingCode: string) {
  const expiryMinutes = Math.round(TELEGRAM_PAIRING_CODE_TTL_MS / 60_000);
  return [
    "This Telegram user is not paired with this Pixelclaw instance.",
    "On the machine running Pixelclaw, run:",
    `${TELEGRAM_PAIRING_COMMAND_PREFIX} ${pairingCode}`,
    "After that, this Telegram user can use the bot from any chat or device.",
    `This code expires in ${expiryMinutes} minutes.`,
  ].join("\n");
}

function createTelegramPairingCode() {
  const rawCode = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
}
