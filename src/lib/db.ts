import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

export type DB = Database.Database;

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** Applies pending SQL files from /migrations in filename order. Idempotent. */
export function migrate(db: DB): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const done = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(f);
    })();
    applied.push(f);
  }
  return applied;
}

const g = globalThis as unknown as { __openframeDb?: DB };

export function getDb(): DB {
  if (!g.__openframeDb) {
    const db = openDb(config.databasePath);
    migrate(db);
    g.__openframeDb = db;
  }
  return g.__openframeDb;
}

/** Test helper: swap the process-wide database. */
export function setDb(db: DB | undefined) {
  g.__openframeDb = db;
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
