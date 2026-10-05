import { getDb } from "../db";
import { notFound } from "../errors";
import { logAudit } from "./audit";
import { applyTransition } from "./claims";
import { purgePickupNow, releaseOpenAssignments } from "./pickups";

/**
 * Deletes an account and its private data.
 * - Open claims are cancelled (their requests reopen), and every pickup address, note and phone number the person
 *   entered is erased now (not at the 7-day mark).
 * - Open volunteer assignments are released (a scheduled pickup left with fewer than two volunteers reopens), as are
 *   delivery runs and future shift sign-ups.
 * - Chapter roles, partner access, favourites, safety acknowledgements and sign-in records are removed.
 * - Requests they posted stay (the partner still needs them) without the author link. Stock history, received claims and
 *   concern reports stay as counts and safety records, detached from the person.
 */
export function deleteAccount(userId: string) {
  const db = getDb();
  const u = db.prepare('SELECT id FROM "user" WHERE id = ?').get(userId);
  if (!u) throw notFound("Account not found");
  db.transaction(() => {
    for (const c of db.prepare("SELECT id, status FROM claim WHERE neighbour_id = ?").all(userId) as { id: string; status: string }[]) {
      if (c.status === "claimed" || c.status === "scheduled") applyTransition(c.id, "cancelled", "Account deleted");
      purgePickupNow(c.id);
    }
    releaseOpenAssignments(userId, null);
    db.prepare("DELETE FROM delivery_volunteer WHERE user_id = ? AND delivery_id IN (SELECT id FROM delivery WHERE status <> 'completed')").run(userId);
    // Remaining foreign keys to "user" use ON DELETE SET NULL / CASCADE.
    db.prepare('DELETE FROM "user" WHERE id = ?').run(userId);
  })();
  logAudit(null, "account_deleted");
  return { deleted: true };
}
