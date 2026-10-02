// Usage: npm run db:backup [-- /path/to/backup.db]
// Uses SQLite's online backup API, so it is safe while the site is running.
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = process.argv[2] || path.join(process.env.BACKUP_DIRECTORY || "backups", `openframe-${timestamp}.db`);
fs.mkdirSync(path.dirname(out), { recursive: true });
getDb()
  .backup(out)
  .then(() => {
    fs.chmodSync(out, 0o600);
    console.log(`Backup written to ${out}`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
