import { getDb } from "../db";
import { notFound } from "../errors";
import { logAudit } from "./audit";

/** Deletes an account. (Pledge, pickup and volunteer cleanup is added with the pledge services.) */
export function deleteAccount(userId: string) {
  const db = getDb();
  const u = db.prepare('SELECT id FROM "user" WHERE id = ?').get(userId);
  if (!u) throw notFound("Account not found");
  db.transaction(() => {
    db.prepare('DELETE FROM "user" WHERE id = ?').run(userId);
  })();
  logAudit(null, "account_deleted");
  return { deleted: true };
}
