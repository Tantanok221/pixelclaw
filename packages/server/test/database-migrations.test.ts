import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";

async function createTempDatabasePath() {
  const directory = await mkdtemp(path.join(tmpdir(), "pixelclaw-db-"));
  return {
    databasePath: path.join(directory, "pixelclaw.sqlite"),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

describe("database migrations", () => {
  it("records applied Drizzle migrations for a fresh database", async () => {
    const temp = await createTempDatabasePath();

    try {
      const database = createDatabase(temp.databasePath);
      const migrationRows = database.sqlite
        .prepare('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at ASC')
        .all() as Array<{ hash: string; created_at: number }>;

      expect(migrationRows.length).toBeGreaterThan(0);

      database.sqlite.close();
    } finally {
      await temp.cleanup();
    }
  });

  it("stamps migration history for a legacy database that already matches the current schema", async () => {
    const temp = await createTempDatabasePath();

    try {
      const sqlite = new Database(temp.databasePath);
      sqlite.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_thread_id TEXT
        );

        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id),
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id),
          user_message_id TEXT NOT NULL REFERENCES messages(id),
          assistant_message_id TEXT NOT NULL REFERENCES messages(id),
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          started_at TEXT,
          finished_at TEXT
        );

        CREATE TABLE run_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id),
          thread_id TEXT NOT NULL REFERENCES threads(id),
          session_id TEXT NOT NULL REFERENCES sessions(id),
          source TEXT NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE telegram_chats (
          chat_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          last_update_id INTEGER,
          mode TEXT NOT NULL DEFAULT 'work',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE telegram_users (
          user_id TEXT PRIMARY KEY,
          is_authorized INTEGER NOT NULL,
          pairing_code TEXT UNIQUE,
          pairing_code_expires_at TEXT,
          paired_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE session_handoffs (
          id TEXT PRIMARY KEY,
          from_session_id TEXT NOT NULL REFERENCES sessions(id),
          to_session_id TEXT NOT NULL REFERENCES sessions(id),
          summary_message_id TEXT NOT NULL REFERENCES messages(id),
          created_at TEXT NOT NULL
        );
      `);
      sqlite.close();

      const database = createDatabase(temp.databasePath);
      const migrationRows = database.sqlite
        .prepare('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at ASC')
        .all() as Array<{ hash: string; created_at: number }>;

      expect(migrationRows.length).toBeGreaterThan(0);

      database.sqlite.close();
    } finally {
      await temp.cleanup();
    }
  });

  it("upgrades a legacy database to the current schema before stamping the Drizzle baseline", async () => {
    const temp = await createTempDatabasePath();

    try {
      const sqlite = new Database(temp.databasePath);
      sqlite.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_thread_id TEXT
        );

        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id),
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id),
          user_message_id TEXT NOT NULL REFERENCES messages(id),
          assistant_message_id TEXT NOT NULL REFERENCES messages(id),
          status TEXT NOT NULL,
          error TEXT,
          started_at TEXT,
          finished_at TEXT
        );

        CREATE TABLE telegram_chats (
          chat_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE telegram_users (
          user_id TEXT PRIMARY KEY,
          is_authorized INTEGER NOT NULL,
          pairing_code TEXT UNIQUE,
          pairing_code_expires_at TEXT,
          paired_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE session_handoffs (
          id TEXT PRIMARY KEY,
          from_session_id TEXT NOT NULL REFERENCES sessions(id),
          to_session_id TEXT NOT NULL REFERENCES sessions(id),
          summary_message_id TEXT NOT NULL REFERENCES messages(id),
          created_at TEXT NOT NULL
        );
      `);
      sqlite.close();

      const database = createDatabase(temp.databasePath);
      const runEventsTable = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_events'")
        .get() as { name?: string } | undefined;
      const runColumns = database.sqlite
        .prepare("PRAGMA table_info(runs)")
        .all() as Array<{ name?: string }>;
      const telegramChatColumns = database.sqlite
        .prepare("PRAGMA table_info(telegram_chats)")
        .all() as Array<{ name?: string }>;
      const migrationRows = database.sqlite
        .prepare('SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at ASC')
        .all() as Array<{ hash: string; created_at: number }>;

      expect(runEventsTable?.name).toBe("run_events");
      expect(runColumns.some((column) => column.name === "source")).toBe(true);
      expect(telegramChatColumns.some((column) => column.name === "last_update_id")).toBe(true);
      expect(telegramChatColumns.some((column) => column.name === "mode")).toBe(true);
      expect(migrationRows.length).toBeGreaterThan(0);

      database.sqlite.close();
    } finally {
      await temp.cleanup();
    }
  });
});
