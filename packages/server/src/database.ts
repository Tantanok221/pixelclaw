import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { createServerDaos, type ServerDaos } from "./dao/index.js";
import * as schema from "./schema.js";

export interface DatabaseContext {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  daos: ServerDaos;
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const APPLICATION_TABLES = [
  "sessions",
  "threads",
  "messages",
  "runs",
  "run_events",
  "telegram_chats",
  "telegram_users",
  "session_handoffs",
] as const;

export function createDatabase(filename = ":memory:"): DatabaseContext {
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  if (isLegacyDatabaseWithoutMigrationHistory(sqlite)) {
    repairLegacySchema(sqlite);
    stampMigrationBaseline(sqlite);
  } else {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  return {
    sqlite,
    db,
    daos: createServerDaos(db),
  };
}

function isLegacyDatabaseWithoutMigrationHistory(sqlite: Database.Database) {
  return !tableExists(sqlite, "__drizzle_migrations") && APPLICATION_TABLES.some((tableName) => tableExists(sqlite, tableName));
}

function repairLegacySchema(sqlite: Database.Database) {
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

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      thread_id TEXT NOT NULL REFERENCES threads(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_chats (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_users (
      user_id TEXT PRIMARY KEY,
      is_authorized INTEGER NOT NULL,
      pairing_code TEXT UNIQUE,
      pairing_code_expires_at TEXT,
      paired_at TEXT,
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

  const runColumns = sqlite.prepare("PRAGMA table_info(runs)").all() as Array<{ name?: string }>;

  if (!runColumns.some((column) => column.name === "source")) {
    sqlite.exec("ALTER TABLE runs ADD COLUMN source TEXT NOT NULL DEFAULT 'web'");
  }
}

function stampMigrationBaseline(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const insertMigration = sqlite.prepare(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  );

  const transaction = sqlite.transaction(() => {
    for (const migration of migrations) {
      insertMigration.run(migration.hash, migration.folderMillis);
    }
  });

  transaction();
}

function tableExists(sqlite: Database.Database, tableName: string) {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;

  return row?.name === tableName;
}
