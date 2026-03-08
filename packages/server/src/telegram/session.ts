import type { ChatRepository } from "../repository.js";

export async function getOrCreateTelegramThread(repository: ChatRepository, chatId: string) {
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

export async function resetTelegramChatSession(repository: ChatRepository, chatId: string) {
  const session = await repository.createSession();
  const thread = await repository.createThread(session.id);
  await repository.setTelegramChatSession(chatId, session.id);
  return { session, thread };
}
