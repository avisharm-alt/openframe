import { getDb } from "../db";
import { notFound } from "../errors";
import { logEvent } from "./events";

/**
 * Deletes an account and its private data.
 * - Practice history, bookmarks, sessions and credentials are removed.
 * - Drafts, pending and rejected contributions are removed.
 * - Published questions stay in the bank (they are licensed content) but lose their author link, so they become anonymous.
 * - Reports keep their text but lose the reporter link.
 */
export function deleteAccount(userId: string) {
  const db = getDb();
  const u = db.prepare('SELECT id FROM "user" WHERE id = ?').get(userId);
  if (!u) throw notFound("Account not found");
  db.transaction(() => {
    const own = db.prepare("SELECT id, state FROM question WHERE author_id = ?").all(userId) as { id: string; state: string }[];
    for (const q of own) {
      if (["draft", "pending_review", "changes_requested", "rejected"].includes(q.state) && !db.prepare("SELECT 1 FROM question WHERE id=? AND live_revision_id IS NOT NULL").get(q.id)) {
        db.prepare("DELETE FROM report WHERE question_id = ?").run(q.id);
        db.prepare("DELETE FROM question WHERE id = ?").run(q.id);
      }
    }
    db.prepare("UPDATE question SET author_id = NULL, public_attribution = 0 WHERE author_id = ?").run(userId);
    // Remaining FKs to "user" use ON DELETE SET NULL / CASCADE (sessions, bookmarks, auth sessions, accounts).
    db.prepare('DELETE FROM "user" WHERE id = ?').run(userId);
  })();
  logEvent(null, "account_deleted");
  return { deleted: true };
}
