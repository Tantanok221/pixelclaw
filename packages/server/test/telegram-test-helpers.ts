interface SentMessage {
  chatId: string;
  text: string;
  messageId: number;
}

interface EditedMessage {
  chatId: string;
  messageId: number;
  text: string;
}

interface DeletedMessage {
  chatId: string;
  messageId: number;
}

export interface TelegramTestTransport {
  sentMessages: SentMessage[];
  editedMessages: EditedMessage[];
  deletedMessages: DeletedMessage[];
  sendMessage(chatId: string, text: string): Promise<{ messageId: number }>;
  editMessageText(chatId: string, messageId: number, text: string): Promise<void>;
  deleteMessage(chatId: string, messageId: number): Promise<void>;
}

export async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  await assertion();
}

export function createTelegramTransport(): TelegramTestTransport {
  const sentMessages: SentMessage[] = [];
  const editedMessages: EditedMessage[] = [];
  const deletedMessages: DeletedMessage[] = [];
  let nextMessageId = 1;

  return {
    sentMessages,
    editedMessages,
    deletedMessages,
    async sendMessage(chatId: string, text: string) {
      const message = {
        chatId,
        text,
        messageId: nextMessageId++,
      };
      sentMessages.push(message);
      return { messageId: message.messageId };
    },
    async editMessageText(chatId: string, messageId: number, text: string) {
      editedMessages.push({ chatId, messageId, text });
    },
    async deleteMessage(chatId: string, messageId: number) {
      deletedMessages.push({ chatId, messageId });
    },
  };
}
