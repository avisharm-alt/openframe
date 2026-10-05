import { getDb } from "../db";
import { notFound } from "../errors";
import { logAudit } from "./audit";
import { applyTransition } from "./pledges";
import { purgePickupNow, releaseOpenAssignments } from "./pickups";

/**
 * Deletes an account and its private data.
 * - Open pledges are cancelled, and every pickup address, note and phone number the person entered is erased now
 *   (not at the 7-day mark).
 * - Open volunteer assignments are released, and a scheduled pickup left with fewer than two volunteers reopens.
 * - Chapter roles, safety acknowledgements and sign-in records are removed.
 * - Stock history, received pledges and concern reports stay (counts and safety records), detached from the person.
 */
export function deleteAccount(userId: string) {
  const db = getDb();
  const u = db.prepare('SELECT id FROM "user" WHERE id = ?').get(userId);
  if (!u) throw notFound("Account not found");
  db.transaction(() => {
    const mine = db.prepare("SELECT id, status FROM pledge WHERE donor_id = ?").all(userId) as { id: string; status: string }[];
    for (const p of mine) {
      if (p.status === "pledged" || p.status === "scheduled") applyTransition(p.id, "cancelled", "Account deleted");
      purgePickupNow(p.id);
    }
    releaseOpenAssignments(userId, null);
    // Remaining foreign keys to "user" use ON DELETE SET NULL / CASCADE.
    db.prepare('DELETE FROM "user" WHERE id = ?').run(userId);
  })();
  logAudit(null, "account_deleted");
  return { deleted: true };
}
