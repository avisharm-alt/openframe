import { z } from "zod";
import { getDb, now, uid } from "../db";
import { conflict } from "../errors";
import { adjustSchema } from "../validation";
import type { Actor, ItemCategory } from "../types";
import { logAudit } from "./audit";
import { requireCoordinator } from "./access";
import { getItem } from "./items";

export type LedgerKind = "received" | "assembled_into_package" | "adjusted" | "discarded";
export type LedgerEntry = { chapterId: string; itemId: string; delta: number; kind: LedgerKind; pledgeId?: string | null; packageId?: string | null; note?: string; actorId?: string | null };

/**
 * The only place that writes to the inventory ledger. Stock is the sum of the ledger; a database trigger refuses
 * any row that would take an item below zero, and this wrapper turns that refusal into a clear 409.
 * Call inside a transaction when several rows must succeed or fail together.
 */
export function appendLedger(e: LedgerEntry) {
  try {
    getDb()
      .prepare("INSERT INTO inventory_ledger (id, chapter_id, item_id, delta, kind, pledge_id, package_id, note, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(uid(), e.chapterId, e.itemId, e.delta, e.kind, e.pledgeId ?? null, e.packageId ?? null, e.note ?? "", e.actorId ?? null, now());
  } catch (err) {
    if (err instanceof Error && err.message.includes("stock_negative")) {
      throw conflict("insufficient_stock", "There is not enough stock of that item for this change.");
    }
    throw err;
  }
}

export function stockOf(chapterId: string, itemId: string): number {
  const r = getDb().prepare("SELECT COALESCE(SUM(delta), 0) AS n FROM inventory_ledger WHERE chapter_id = ? AND item_id = ?").get(chapterId, itemId) as { n: number };
  return r.n;
}

export function stockByItem(chapterId: string): Map<string, number> {
  const rows = getDb().prepare("SELECT item_id AS itemId, SUM(delta) AS n FROM inventory_ledger WHERE chapter_id = ? GROUP BY item_id").all(chapterId) as { itemId: string; n: number }[];
  return new Map(rows.map((r) => [r.itemId, r.n]));
}

export type InventoryRow = { itemId: string; name: string; category: ItemCategory; unit: string; stock: number };

export function listInventory(actor: Actor, chapterId: string): InventoryRow[] {
  requireCoordinator(actor, chapterId);
  const stock = stockByItem(chapterId);
  const items = getDb().prepare("SELECT id, name, category, unit FROM item WHERE active = 1 ORDER BY category, name").all() as { id: string; name: string; category: ItemCategory; unit: string }[];
  return items.map((i) => ({ itemId: i.id, name: i.name, category: i.category, unit: i.unit, stock: stock.get(i.id) ?? 0 }));
}

export type LedgerRow = { id: string; itemName: string; delta: number; kind: LedgerKind; note: string; createdAt: string };
export function listLedger(actor: Actor, chapterId: string, limit = 50): LedgerRow[] {
  requireCoordinator(actor, chapterId);
  return getDb()
    .prepare(
      `SELECT l.id, i.name AS itemName, l.delta, l.kind, l.note, l.created_at AS createdAt
         FROM inventory_ledger l JOIN item i ON i.id = l.item_id WHERE l.chapter_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT ?`,
    )
    .all(chapterId, Math.min(Math.max(limit, 1), 200)) as LedgerRow[];
}

/** Manual stock corrections: a signed count fix, or discarding spoiled / unusable items. Always with a note. */
export function adjustStock(actor: Actor, chapterId: string, raw: z.input<typeof adjustSchema>) {
  requireCoordinator(actor, chapterId);
  const input = adjustSchema.parse(raw);
  getItem(input.itemId);
  const delta = input.kind === "discarded" ? -input.quantity : input.delta;
  appendLedger({ chapterId, itemId: input.itemId, delta, kind: input.kind, note: input.note, actorId: actor.id });
  logAudit(actor.id, input.kind === "discarded" ? "stock_discarded" : "stock_adjusted", { chapterId, subjectType: "item", subjectId: input.itemId, detail: { delta } });
  return { stock: stockOf(chapterId, input.itemId) };
}
