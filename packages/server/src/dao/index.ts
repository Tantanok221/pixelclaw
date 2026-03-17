import type { DatabaseClient } from "./shared.js";
import { GithubAccountsDao } from "./githubAccountsDao.js";
import { MonitorEventsDao } from "./monitorEventsDao.js";
import { MonitorNotificationsDao } from "./monitorNotificationsDao.js";
import { MonitorPrSnapshotsDao } from "./monitorPrSnapshotsDao.js";
import { MessagesDao } from "./messagesDao.js";
import { MonitorsDao } from "./monitorsDao.js";
import { RunEventsDao } from "./runEventsDao.js";
import { RunsDao } from "./runsDao.js";
import { SessionHandoffsDao } from "./sessionHandoffsDao.js";
import { SessionsDao } from "./sessionsDao.js";
import { TelegramChatsDao, TelegramUsersDao } from "./telegramDao.js";
import { ThreadsDao } from "./threadsDao.js";

export interface ServerDaos {
  githubAccounts: GithubAccountsDao;
  monitorEvents: MonitorEventsDao;
  monitorNotifications: MonitorNotificationsDao;
  monitorPrSnapshots: MonitorPrSnapshotsDao;
  messages: MessagesDao;
  monitors: MonitorsDao;
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
    githubAccounts: new GithubAccountsDao(db),
    monitorEvents: new MonitorEventsDao(db),
    monitorNotifications: new MonitorNotificationsDao(db),
    monitorPrSnapshots: new MonitorPrSnapshotsDao(db),
    messages: new MessagesDao(db),
    monitors: new MonitorsDao(db),
    runEvents: new RunEventsDao(db),
    runs: new RunsDao(db),
    sessionHandoffs: new SessionHandoffsDao(db),
    sessions: new SessionsDao(db),
    telegramChats: new TelegramChatsDao(db),
    telegramUsers: new TelegramUsersDao(db),
    threads: new ThreadsDao(db),
  };
}
