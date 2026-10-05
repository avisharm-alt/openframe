import { getDb, now, uid } from "../db";
import { conflict } from "../errors";
import { adjustSchema } from "../validation";
import type { Actor, ItemCategory, LedgerKind } from "../types";
import { logAudit } from "./audit";
import { requireCoordinator } from "./access";
import { getItem, normalizeSize } from "./items";

export type LedgerEntry = {
  chapterId: string; itemId: string; size?: string; delta: number; kind: LedgerKind;
  claimId?: string | null; requestId?: string | null; kitId?: string | null; note?: string; actorId?: string | null;
};

/**
 * The only place that writes to the fast-stock ledger. Stock (per chapter, item and size) is the sum of the ledger;
 * a database trigger refuses any row that would take it below zero, and this wrapper turns that into a clear 409.
 * Call inside a transaction when several rows must succeed or fail together.
 */
export function appendLedger(e: LedgerEntry) {
  try {
    getDb()
      .prepare("INSERT INTO stock_ledger (id, chapter_id, item_id, size, delta, kind, claim_id, request_id, kit_id, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(uid(), e.chapterId, e.itemId, e.size ?? "", e.delta, e.kind, e.claimId ?? null, e.requestId ?? null, e.kitId ?? null, e.note ?? "", e.actorId ?? null, now());
  } catch (err) {
    if (err instanceof Error && err.message.includes("stock_negative")) throw conflict("insufficient_stock", "There is not enough stock of that item for this change.");
    throw err;
  }
}

export const stockOf = (chapterId: string, itemId: string, size = ""): number =>
  (getDb().prepare("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_ledger WHERE chapter_id = ? AND item_id = ? AND size = ?").get(chapterId, itemId, size) as { n: number }).n;

export const stockKey = (itemId: string, size: string) => `${itemId}|${size}`;
export function stockMap(chapterId: string): Map<string, number> {
  const rows = getDb().prepare("SELECT item_id AS itemId, size, SUM(delta) AS n FROM stock_ledger WHERE chapter_id = ? GROUP BY item_id, size").all(chapterId) as { itemId: string; size: string; n: number }[];
  return new Map(rows.map((r) => [stockKey(r.itemId, r.size), r.n]));
}

export type StockRow = { itemId: string; name: string; category: ItemCategory; size: string; unit: string; stock: number; target: number | null };

/** Every item/size that has stock or a restock target (and every unsized active item, so a count can be added). */
export function listStock(actor: Actor, chapterId: string): StockRow[] {
  requireCoordinator(actor, chapterId);
  const db = getDb();
  const stock = stockMap(chapterId);
  const targets = new Map((db.prepare("SELECT item_id AS itemId, size, target FROM restock_target WHERE chapter_id = ?").all(chapterId) as { itemId: string; size: string; target: number }[]).map((t) => [stockKey(t.itemId, t.size), t.target]));
  const items = db.prepare("SELECT id, name, category, size_scheme AS scheme, unit FROM item WHERE active = 1 ORDER BY category, name").all() as { id: string; name: string; category: ItemCategory; scheme: string; unit: string }[];
  const out: StockRow[] = [];
  for (const i of items) {
    const sizes = new Set<string>(i.scheme === "none" ? [""] : []);
    for (const k of [...stock.keys(), ...targets.keys()]) if (k.startsWith(i.id + "|")) sizes.add(k.slice(i.id.length + 1));
    for (const size of sizes) out.push({ itemId: i.id, name: i.name, category: i.category, size, unit: i.unit, stock: stock.get(stockKey(i.id, size)) ?? 0, target: targets.get(stockKey(i.id, size)) ?? null });
  }
  return out;
}

export type LedgerRow = { id: string; itemName: string; size: string; delta: number; kind: LedgerKind; note: string; createdAt: string };
export function listLedger(actor: Actor, chapterId: string, limit = 50): LedgerRow[] {
  requireCoordinator(actor, chapterId);
  return getDb()
    .prepare(
      `SELECT l.id, i.name AS itemName, l.size, l.delta, l.kind, l.note, l.created_at AS createdAt
         FROM stock_ledger l JOIN item i ON i.id = l.item_id WHERE l.chapter_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT ?`,
    )
    .all(chapterId, Math.min(Math.max(limit, 1), 200)) as LedgerRow[];
}

/** Manual corrections: a signed recount, or discarding spoiled / unusable items. Always with a note. */
export function adjustStock(actor: Actor, chapterId: string, raw: unknown) {
  requireCoordinator(actor, chapterId);
  const input = adjustSchema.parse(raw);
  const item = getItem(input.itemId);
  const size = normalizeSize(item, input.size);
  const delta = input.kind === "discarded" ? -input.quantity : input.delta;
  appendLedger({ chapterId, itemId: item.id, size, delta, kind: input.kind, note: input.note, actorId: actor.id });
  logAudit(actor.id, input.kind === "discarded" ? "stock_discarded" : "stock_adjusted", { chapterId, subjectType: "item", subjectId: item.id, detail: { delta, size } });
  return { stock: stockOf(chapterId, item.id, size) };
}
