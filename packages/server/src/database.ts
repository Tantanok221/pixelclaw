import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export interface DatabaseContext {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function createDatabase(filename = ":memory:"): DatabaseContext {
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_thread_id TEXT
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      user_message_id TEXT NOT NULL REFERENCES messages(id),
      assistant_message_id TEXT NOT NULL REFERENCES messages(id),
      status TEXT NOT NULL,
      error TEXT,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_chats (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      last_update_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_handoffs (
      id TEXT PRIMARY KEY,
      from_session_id TEXT NOT NULL REFERENCES sessions(id),
      to_session_id TEXT NOT NULL REFERENCES sessions(id),
      summary_message_id TEXT NOT NULL REFERENCES messages(id),
      created_at TEXT NOT NULL
    );
  `);

  const telegramChatColumns = sqlite
    .prepare("PRAGMA table_info(telegram_chats)")
    .all() as Array<{ name?: string }>;

  if (!telegramChatColumns.some((column) => column.name === "last_update_id")) {
    sqlite.exec("ALTER TABLE telegram_chats ADD COLUMN last_update_id INTEGER");
  }

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
