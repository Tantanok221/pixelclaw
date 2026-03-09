import type { DatabaseClient } from "./shared.js";
import { MessagesDao } from "./messagesDao.js";
import { RunEventsDao } from "./runEventsDao.js";
import { RunsDao } from "./runsDao.js";
import { SessionHandoffsDao } from "./sessionHandoffsDao.js";
import { SessionsDao } from "./sessionsDao.js";
import { TelegramChatsDao, TelegramUsersDao } from "./telegramDao.js";
import { ThreadsDao } from "./threadsDao.js";

export interface ServerDaos {
  messages: MessagesDao;
  runEvents: RunEventsDao;
  runs: RunsDao;
  sessionHandoffs: SessionHandoffsDao;
  sessions: SessionsDao;
  telegramChats: TelegramChatsDao;
  telegramUsers: TelegramUsersDao;
  threads: ThreadsDao;
}

export function createServerDaos(db: DatabaseClient): ServerDaos {
  return {
    messages: new MessagesDao(db),
    runEvents: new RunEventsDao(db),
    runs: new RunsDao(db),
    sessionHandoffs: new SessionHandoffsDao(db),
    sessions: new SessionsDao(db),
    telegramChats: new TelegramChatsDao(db),
    telegramUsers: new TelegramUsersDao(db),
    threads: new ThreadsDao(db),
  };
}
