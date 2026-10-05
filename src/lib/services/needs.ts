import { getDb, now, uid } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { needPatchSchema, needSchema } from "../validation";
import { PRIORITY_RANK, type Actor, type ItemCategory, type NeedPriority } from "../types";
import { logAudit } from "./audit";
import { requireCoordinator } from "./access";
import { stockByItem } from "./inventory";
import { getItem } from "./items";
import { deriveTemplateNeeds, syncTemplateNeeds, type DerivedNeed } from "./templates";

export type NeedStatus = "open" | "met" | "closed";
export type BoardLine = {
  needId: string;
  itemId: string;
  itemName: string;
  category: ItemCategory;
  unit: string;
  newOnly: boolean;
  source: "manual" | "template";
  priority: NeedPriority;
  note: string;
  needed: number;
  pledged: number; // promised and not yet counted into stock
  received: number; // counted into stock
  remaining: number; // still unpledged: what a new pledge can cover
  status: NeedStatus;
};

type NeedRow = {
  id: string; item_id: string; source: "manual" | "template"; quantity: number; priority: NeedPriority; note: string; status: NeedStatus;
  name: string; category: ItemCategory; unit: string; new_only: number;
};

const OUTSTANDING = "('pledged','scheduled','collected')";

function outstandingPledged(needId: string): number {
  const r = getDb().prepare(`SELECT COALESCE(SUM(pi.quantity), 0) AS n FROM pledge_item pi JOIN pledge p ON p.id = pi.pledge_id WHERE pi.need_id = ? AND p.status IN ${OUTSTANDING}`).get(needId) as { n: number };
  return r.n;
}
function receivedAgainst(needId: string): number {
  const r = getDb().prepare("SELECT COALESCE(SUM(pi.received_quantity), 0) AS n FROM pledge_item pi JOIN pledge p ON p.id = pi.pledge_id WHERE pi.need_id = ? AND p.status = 'received'").get(needId) as { n: number };
  return r.n;
}

function buildLine(row: NeedRow, derived: Map<string, DerivedNeed>, stock: Map<string, number>): BoardLine {
  const pledgedOut = outstandingPledged(row.id);
  let needed: number, received: number, pledged: number, priority = row.priority, status: NeedStatus;
  if (row.source === "template") {
    const d = derived.get(row.item_id);
    needed = d?.target ?? 0;
    received = Math.min(stock.get(row.item_id) ?? 0, needed);
    pledged = Math.min(pledgedOut, Math.max(0, needed - received));
    status = needed === 0 ? "closed" : received >= needed ? "met" : "open";
    // A standing need becomes more pressing the emptier the shelf is.
    priority = needed > 0 && received / needed < 0.25 ? "high" : "normal";
  } else {
    needed = row.quantity;
    received = receivedAgainst(row.id);
    pledged = Math.min(pledgedOut, Math.max(0, needed - received));
    status = row.status === "closed" ? "closed" : received >= needed ? "met" : "open";
  }
  return {
    needId: row.id, itemId: row.item_id, itemName: row.name, category: row.category, unit: row.unit, newOnly: !!row.new_only,
    source: row.source, priority, note: row.note, needed, pledged, received, remaining: Math.max(0, needed - received - pledged), status,
  };
}

function loadRows(chapterId: string, extra = "", params: unknown[] = []): NeedRow[] {
  return getDb()
    .prepare(
      `SELECT n.id, n.item_id, n.source, n.quantity, n.priority, n.note, n.status, i.name, i.category, i.unit, i.new_only
         FROM need n JOIN item i ON i.id = n.item_id WHERE n.chapter_id = ? ${extra}`,
    )
    .all(chapterId, ...params) as NeedRow[];
}

/** Every need of the chapter with live numbers (open, met and closed), most urgent first. */
export function computeLines(chapterId: string): BoardLine[] {
  syncTemplateNeeds(chapterId);
  const derived = new Map(deriveTemplateNeeds(chapterId).map((d) => [d.itemId, d]));
  const stock = stockByItem(chapterId);
  return loadRows(chapterId).map((r) => buildLine(r, derived, stock)).sort(byPressure);
}

const byPressure = (a: BoardLine, b: BoardLine) =>
  PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.remaining - a.remaining || b.needed - a.needed || a.itemName.localeCompare(b.itemName);

/** The public "What we need right now" board: open needs only, sorted by priority then shortfall. No account needed. */
export function listBoard(chapterId: string): BoardLine[] {
  return computeLines(chapterId).filter((l) => l.status === "open" && l.needed > 0);
}

/** The live line for one need (used to validate pledges). */
export function getLine(needId: string): (BoardLine & { chapterId: string }) | null {
  const r = getDb().prepare("SELECT chapter_id AS chapterId FROM need WHERE id = ?").get(needId) as { chapterId: string } | undefined;
  if (!r) return null;
  const line = computeLines(r.chapterId).find((l) => l.needId === needId);
  return line ? { ...line, chapterId: r.chapterId } : null;
}

/** Coordinators see everything, including met and closed needs, to manage them. */
export function listNeeds(actor: Actor, chapterId: string): BoardLine[] {
  requireCoordinator(actor, chapterId);
  return computeLines(chapterId);
}

export function createNeed(actor: Actor, chapterId: string, raw: unknown): BoardLine {
  requireCoordinator(actor, chapterId);
  const input = needSchema.parse(raw);
  const item = getItem(input.itemId);
  if (!item.active) throw invalid("That item is no longer in the catalog.");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM need WHERE chapter_id = ? AND item_id = ? AND source = 'manual' AND status <> 'closed'").get(chapterId, input.itemId)) {
    throw conflict("need_exists", "There is already a posted need for that item. Edit it instead.");
  }
  const id = uid();
  db.prepare("INSERT INTO need (id, chapter_id, item_id, source, quantity, priority, note, status, created_by, created_at, updated_at) VALUES (?,?,?,'manual',?,?,?,'open',?,?,?)").run(id, chapterId, input.itemId, input.quantity, input.priority, input.note, actor.id, now(), now());
  logAudit(actor.id, "need_created", { chapterId, subjectType: "need", subjectId: id });
  return computeLines(chapterId).find((l) => l.needId === id)!;
}

export function updateNeed(actor: Actor, needId: string, raw: unknown): BoardLine {
  const row = getDb().prepare("SELECT chapter_id AS chapterId, source FROM need WHERE id = ?").get(needId) as { chapterId: string; source: string } | undefined;
  if (!row) throw notFound("Need not found");
  requireCoordinator(actor, row.chapterId);
  if (row.source === "template") throw conflict("derived_need", "This need is calculated from package templates and current stock. Edit the template instead.");
  const p = needPatchSchema.parse(raw);
  const db = getDb();
  const cur = db.prepare("SELECT quantity, priority, note, status FROM need WHERE id = ?").get(needId) as { quantity: number; priority: NeedPriority; note: string; status: NeedStatus };
  db.prepare("UPDATE need SET quantity = ?, priority = ?, note = ?, status = ?, updated_at = ? WHERE id = ?").run(
    p.quantity ?? cur.quantity, p.priority ?? cur.priority, p.note ?? cur.note, p.status ?? (cur.status === "closed" ? "closed" : "open"), now(), needId,
  );
  refreshManualStatuses(row.chapterId);
  logAudit(actor.id, "need_updated", { chapterId: row.chapterId, subjectType: "need", subjectId: needId, detail: { status: p.status ?? null } });
  return computeLines(row.chapterId).find((l) => l.needId === needId)!;
}

/** Persists open/met for manual needs after receipts or edits (the board itself always computes live). */
export function refreshManualStatuses(chapterId: string) {
  const db = getDb();
  const rows = db.prepare("SELECT id, quantity, status FROM need WHERE chapter_id = ? AND source = 'manual' AND status <> 'closed'").all(chapterId) as { id: string; quantity: number; status: NeedStatus }[];
  for (const r of rows) {
    const next: NeedStatus = receivedAgainst(r.id) >= r.quantity ? "met" : "open";
    if (next !== r.status) db.prepare("UPDATE need SET status = ?, updated_at = ? WHERE id = ?").run(next, now(), r.id);
  }
}
