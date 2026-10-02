// Usage: npm run admin:purge-guests [-- <days>]  (default 30)
// Deletes guest practice sessions (no user) older than N days. Run from cron.
import { getDb } from "../src/lib/db";

const days = Number(process.argv[2] || 30);
const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
const r = getDb().prepare("DELETE FROM practice_session WHERE user_id IS NULL AND created_at < ?").run(cutoff);
console.log(`Deleted ${r.changes} guest sessions older than ${days} days.`);
