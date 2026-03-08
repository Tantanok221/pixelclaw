import type { TelegramTransport } from "./types.js";

export class TelegramEditableMessage {
  protected messageId: number | undefined;
  protected lastText = "";

  constructor(
    protected readonly telegram: TelegramTransport,
    protected readonly chatId: string,
  ) {}

  hasMessage() {
    return this.messageId !== undefined;
  }

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
}

export class TelegramStatusMessage extends TelegramEditableMessage {
  private deleteTimer: NodeJS.Timeout | undefined;

  constructor(
    telegram: TelegramTransport,
    chatId: string,
    private readonly deleteDelayMs: number,
  ) {
    super(telegram, chatId);
  }

  deleteAfterDelay() {
    if (!this.hasMessage()) {
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
