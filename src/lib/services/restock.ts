import { getDb, now, uid } from "../db";
import { targetSchema } from "../validation";
import { addDays, localDate, nowDate } from "../time";
import type { Actor } from "../types";
import { logAudit } from "./audit";
import { getChapter, requireCoordinator } from "./access";
import { getItem, normalizeSize } from "./items";
import { claimedPending } from "./request-core";
import { stockOf } from "./stock";

export const RESTOCK_DAYS = 7;

/**
 * Keeps the board live between agency requests. For every restock target (item + size) whose stock is below target,
 * there is exactly one open "restock" request for the shortfall; when stock recovers an untouched one is withdrawn.
 * Idempotent and cheap: call it after anything that changes stock or targets, and from the sweep job.
 */
export function syncRestock(chapterId: string, at: Date = nowDate()): { posted: number; withdrawn: number } {
  const db = getDb();
  const tz = getChapter(chapterId).timezone;
  const targets = db.prepare("SELECT item_id AS itemId, size, target FROM restock_target WHERE chapter_id = ?").all(chapterId) as { itemId: string; size: string; target: number }[];
  const active = db.prepare("SELECT id, item_id AS itemId, size, quantity, status FROM request WHERE chapter_id = ? AND type = 'restock' AND status IN ('open','claimed')").all(chapterId) as { id: string; itemId: string; size: string; quantity: number; status: string }[];
  const byKey = new Map(active.map((r) => [`${r.itemId}|${r.size}`, r]));
  const wanted = new Set(targets.map((t) => `${t.itemId}|${t.size}`));
  let posted = 0, withdrawn = 0;
  for (const t of targets) {
    const stock = stockOf(chapterId, t.itemId, t.size);
    const deficit = t.target - stock;
    const cur = byKey.get(`${t.itemId}|${t.size}`);
    if (deficit > 0 && !cur) {
      db.prepare(
        "INSERT INTO request (id, chapter_id, partner_id, delivery_site_id, type, item_id, size, kit_template_id, quantity, needed_by, urgency, note, status, created_by, created_at, updated_at) VALUES (?,?,NULL,NULL,'restock',?,?,NULL,?,?,?,?,'open',NULL,?,?)",
      ).run(uid(), chapterId, t.itemId, t.size, deficit, addDays(localDate(tz, at), RESTOCK_DAYS), stock === 0 ? "urgent" : "normal", "Restock: keeps our fast stock ready so common requests are filled the same day.", now(), now());
      posted++;
    } else if (cur && deficit > 0 && cur.status === "open" && claimedPending(cur.id) === 0 && cur.quantity !== deficit) {
      db.prepare("UPDATE request SET quantity = ?, updated_at = ? WHERE id = ?").run(deficit, now(), cur.id);
    } else if (cur && deficit <= 0 && cur.status === "open" && claimedPending(cur.id) === 0) {
      db.prepare("UPDATE request SET status = 'cancelled', status_reason = 'Stock is back at target', updated_at = ? WHERE id = ?").run(now(), cur.id);
      withdrawn++;
    }
  }
  // A target that was removed: withdraw its untouched restock request.
  for (const r of active) {
    if (!wanted.has(`${r.itemId}|${r.size}`) && r.status === "open" && claimedPending(r.id) === 0) {
      db.prepare("UPDATE request SET status = 'cancelled', status_reason = 'Restock target removed', updated_at = ? WHERE id = ?").run(now(), r.id);
      withdrawn++;
    }
  }
  return { posted, withdrawn };
}

/** Restock targets: the level to keep on the shelf. Setting 0 removes the target. Coordinators of the chapter only. */
export function setTarget(actor: Actor, chapterId: string, raw: unknown) {
  requireCoordinator(actor, chapterId);
  const input = targetSchema.parse(raw);
  const item = getItem(input.itemId);
  const size = normalizeSize(item, input.size);
  const db = getDb();
  db.transaction(() => {
    if (input.target === 0) db.prepare("DELETE FROM restock_target WHERE chapter_id = ? AND item_id = ? AND size = ?").run(chapterId, item.id, size);
    else db.prepare("INSERT INTO restock_target (chapter_id, item_id, size, target) VALUES (?,?,?,?) ON CONFLICT (chapter_id, item_id, size) DO UPDATE SET target = excluded.target").run(chapterId, item.id, size, input.target);
    syncRestock(chapterId);
  })();
  logAudit(actor.id, "restock_target_set", { chapterId, subjectType: "item", subjectId: item.id, detail: { size, target: input.target } });
}
