import { loadTelegramConfig } from "../telegramConfig.js";
import type { TelegramApiResult, TelegramPollingTransport, TelegramUpdate } from "./types.js";

export async function createConfiguredTelegramClient(): Promise<TelegramPollingTransport | null> {
  const config = await loadTelegramConfig();
  if (!config) {
    return null;
  }

  return createTelegramClient(config.botToken);
}

export function createTelegramClient(botToken: string): TelegramPollingTransport {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;

  return {
    async getUpdates(offset, timeoutSeconds, signal) {
      const response = await postTelegram<
        TelegramApiResult<
          Array<{
            update_id: number;
            message?: {
              chat?: { id?: number | string };
              from?: { id?: number | string };
              text?: string;
            };
          }>
        >
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
          const userId = update.message?.from?.id;

          if (!text || chatId === undefined || userId === undefined) {
            return null;
          }

          return {
            updateId: update.update_id,
            chatId: String(chatId),
            userId: String(userId),
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

  const rawResponseText = await response.text();
  let responsePayload: TelegramApiResult<T> | T | undefined;

  if (rawResponseText) {
    try {
      responsePayload = JSON.parse(rawResponseText) as TelegramApiResult<T> | T;
    } catch {
      responsePayload = undefined;
    }
  }

  if (!response.ok) {
    if (
      typeof responsePayload === "object" &&
      responsePayload !== null &&
      "description" in responsePayload &&
      typeof responsePayload.description === "string"
    ) {
      throw new Error(responsePayload.description);
    }

    throw new Error(
      rawResponseText
        ? `Telegram API request failed with status ${response.status}: ${rawResponseText}`
        : `Telegram API request failed with status ${response.status}`,
    );
  }

  if (responsePayload === undefined) {
    responsePayload = {} as T;
  }

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
