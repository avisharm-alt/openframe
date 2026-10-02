// Copy a backup into a temporary location and open it as a restored database.
// The source backup and live database are never modified.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, openDb } from "../src/lib/db";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run db:verify-backup -- /path/to/backup.db");
  process.exit(2);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openframe-restore-"));
let db: Database.Database | undefined;
try {
  const restored = path.join(tempDir, "restored.db");
  fs.copyFileSync(path.resolve(source), restored);
  const original = new Database(restored, { readonly: true, fileMustExist: true });
  try {
    const tables = original.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const names = new Set(tables.map((table) => table.name));
    for (const required of ["schema_migrations", "user", "course", "question"]) {
      if (!names.has(required)) throw new Error(`Backup is missing the ${required} table`);
    }
  } finally {
    original.close();
  }
  db = openDb(restored);
  migrate(db);

  const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
  }
  const foreignKeys = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeys.length > 0) throw new Error(`${foreignKeys.length} foreign key violation(s) found`);

  const count = (table: string) => (db!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  console.log(`Restored backup verified: ${count("user")} accounts, ${count("course")} courses, ${count("question")} questions.`);
} catch (error) {
  console.error("Backup restore verification failed:", error);
  process.exitCode = 1;
} finally {
  db?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
