import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  status: text("status").notNull(),
  error: text("error"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const telegramChats = sqliteTable("telegram_chats", {
  chatId: text("chat_id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  lastUpdateId: integer("last_update_id"),
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

export type SessionRow = typeof sessions.$inferSelect;
export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type TelegramChatRow = typeof telegramChats.$inferSelect;
export type SessionHandoffRow = typeof sessionHandoffs.$inferSelect;
