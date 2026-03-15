import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastThreadId: text("last_thread_id"),
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  userMessageId: text("user_message_id")
    .notNull()
    .references(() => messages.id),
  assistantMessageId: text("assistant_message_id")
    .notNull()
    .references(() => messages.id),
  source: text("source").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const runEvents = sqliteTable("run_events", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  source: text("source").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const telegramChats = sqliteTable("telegram_chats", {
  chatId: text("chat_id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  lastUpdateId: integer("last_update_id"),
  mode: text("mode").notNull().default("work"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const telegramUsers = sqliteTable("telegram_users", {
  userId: text("user_id").primaryKey(),
  isAuthorized: integer("is_authorized").notNull(),
  pairingCode: text("pairing_code").unique(),
  pairingCodeExpiresAt: text("pairing_code_expires_at"),
  pairedAt: text("paired_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessionHandoffs = sqliteTable("session_handoffs", {
  id: text("id").primaryKey(),
  fromSessionId: text("from_session_id")
    .notNull()
    .references(() => sessions.id),
  toSessionId: text("to_session_id")
    .notNull()
    .references(() => sessions.id),
  summaryMessageId: text("summary_message_id")
    .notNull()
    .references(() => messages.id),
  createdAt: text("created_at").notNull(),
});

export const monitorEvents = sqliteTable(
  "monitor_events",
  {
    id: text("id").primaryKey(),
    monitorId: text("monitor_id").notNull(),
    provider: text("provider").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    payload: text("payload").notNull(),
    sourceKey: text("source_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    sourceKeyIndex: uniqueIndex("monitor_events_source_key_unique").on(table.sourceKey),
  }),
);

export const monitorNotifications = sqliteTable("monitor_notifications", {
  id: text("id").primaryKey(),
  monitorEventId: text("monitor_event_id")
    .notNull()
    .references(() => monitorEvents.id),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
});

export const githubAccounts = sqliteTable("github_accounts", {
  id: text("id").primaryKey(),
  providerUserId: text("provider_user_id").notNull(),
  login: text("login").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  accessToken: text("access_token").notNull(),
  scopes: text("scopes").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const monitors = sqliteTable("monitors", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  githubAccountId: text("github_account_id")
    .notNull()
    .references(() => githubAccounts.id),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  pollIntervalSeconds: integer("poll_interval_seconds").notNull(),
  nextPollAt: text("next_poll_at").notNull(),
  lastPolledAt: text("last_polled_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const monitorPrSnapshots = sqliteTable("monitor_pr_snapshots", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id")
    .notNull()
    .references(() => monitors.id),
  prNumber: integer("pr_number").notNull(),
  prTitle: text("pr_title").notNull(),
  prUrl: text("pr_url").notNull(),
  headSha: text("head_sha").notNull(),
  mergeableState: text("mergeable_state"),
  checksState: text("checks_state").notNull(),
  latestExternalCommentId: text("latest_external_comment_id"),
  latestExternalCommentAuthorLogin: text("latest_external_comment_author_login"),
  latestExternalCommentBody: text("latest_external_comment_body"),
  latestExternalCommentUrl: text("latest_external_comment_url"),
  latestExternalCommentCreatedAt: text("latest_external_comment_created_at"),
  updatedAt: text("updated_at").notNull(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type TelegramChatRow = typeof telegramChats.$inferSelect;
export type TelegramUserRow = typeof telegramUsers.$inferSelect;
export type SessionHandoffRow = typeof sessionHandoffs.$inferSelect;
export type MonitorEventRow = typeof monitorEvents.$inferSelect;
export type MonitorNotificationRow = typeof monitorNotifications.$inferSelect;
export type GithubAccountRow = typeof githubAccounts.$inferSelect;
export type MonitorRow = typeof monitors.$inferSelect;
export type MonitorPrSnapshotRow = typeof monitorPrSnapshots.$inferSelect;
