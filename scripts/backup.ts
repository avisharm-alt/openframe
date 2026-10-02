// Usage: npm run db:backup [-- ./backups/openframe-YYYYMMDD.db]
// Uses SQLite's online backup API, so it is safe while the site is running.
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db";

const out = process.argv[2] || path.join("backups", `openframe-${new Date().toISOString().slice(0, 10)}.db`);
fs.mkdirSync(path.dirname(out), { recursive: true });
getDb()
  .backup(out)
  .then(() => console.log(`Backup written to ${out}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
