import { getDb, now, uid } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { templatePatchSchema, templateSchema } from "../validation";
import type { Actor, ItemCategory } from "../types";
import { addDays, localDate, nowDate, weekStart, zonedToUtc } from "../time";
import { logAudit } from "./audit";
import { getChapter, requireCoordinator } from "./access";
import { stockByItem } from "./inventory";
import { getItem } from "./items";

export type TemplateItem = { itemId: string; name: string; unit: string; category: ItemCategory; quantity: number };
export type Template = { id: string; chapterId: string; name: string; description: string; weeklyTarget: number; active: boolean; items: TemplateItem[] };
type TRow = { id: string; chapter_id: string; name: string; description: string; weekly_target: number; active: number };

function load(r: TRow): Template {
  const items = getDb()
    .prepare(
      `SELECT ti.item_id AS itemId, i.name, i.unit, i.category, ti.quantity FROM package_template_item ti JOIN item i ON i.id = ti.item_id
        WHERE ti.template_id = ? ORDER BY i.category, i.name`,
    )
    .all(r.id) as TemplateItem[];
  return { id: r.id, chapterId: r.chapter_id, name: r.name, description: r.description, weeklyTarget: r.weekly_target, active: !!r.active, items };
}

export function listTemplates(chapterId: string, opts: { activeOnly?: boolean } = {}): Template[] {
  const rows = getDb().prepare(`SELECT * FROM package_template WHERE chapter_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY name`).all(chapterId) as TRow[];
  return rows.map(load);
}
export function getTemplate(id: string): Template {
  const r = getDb().prepare("SELECT * FROM package_template WHERE id = ?").get(id) as TRow | undefined;
  if (!r) throw notFound("Package template not found");
  return load(r);
}

function checkItems(items: { itemId: string; quantity: number }[]) {
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.itemId)) throw invalid("Each item can appear only once in a template. Increase its quantity instead.");
    seen.add(i.itemId);
    if (!getItem(i.itemId).active) throw invalid("That item is no longer in the catalog.");
  }
}

export function createTemplate(actor: Actor, chapterId: string, raw: unknown): Template {
  requireCoordinator(actor, chapterId);
  const input = templateSchema.parse(raw);
  checkItems(input.items);
  const db = getDb();
  if (db.prepare("SELECT 1 FROM package_template WHERE chapter_id = ? AND name = ?").get(chapterId, input.name)) throw conflict("template_exists", "A template with that name already exists in this chapter.");
  const id = uid();
  db.transaction(() => {
    db.prepare("INSERT INTO package_template (id, chapter_id, name, description, weekly_target, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, chapterId, input.name, input.description, input.weeklyTarget, input.active ? 1 : 0, now(), now());
    for (const i of input.items) db.prepare("INSERT INTO package_template_item (template_id, item_id, quantity) VALUES (?,?,?)").run(id, i.itemId, i.quantity);
    syncTemplateNeeds(chapterId);
  })();
  logAudit(actor.id, "template_created", { chapterId, subjectType: "template", subjectId: id });
  return getTemplate(id);
}

export function updateTemplate(actor: Actor, templateId: string, raw: unknown): Template {
  const t = getTemplate(templateId);
  requireCoordinator(actor, t.chapterId);
  const p = templatePatchSchema.parse(raw);
  if (p.items) checkItems(p.items);
  const db = getDb();
  if (p.name && p.name !== t.name && db.prepare("SELECT 1 FROM package_template WHERE chapter_id = ? AND name = ?").get(t.chapterId, p.name)) {
    throw conflict("template_exists", "A template with that name already exists in this chapter.");
  }
  db.transaction(() => {
    db.prepare("UPDATE package_template SET name = ?, description = ?, weekly_target = ?, active = ?, updated_at = ? WHERE id = ?").run(
      p.name ?? t.name, p.description ?? t.description, p.weeklyTarget ?? t.weeklyTarget, (p.active ?? t.active) ? 1 : 0, now(), templateId,
    );
    if (p.items) {
      db.prepare("DELETE FROM package_template_item WHERE template_id = ?").run(templateId);
      for (const i of p.items) db.prepare("INSERT INTO package_template_item (template_id, item_id, quantity) VALUES (?,?,?)").run(templateId, i.itemId, i.quantity);
    }
    syncTemplateNeeds(t.chapterId);
  })();
  logAudit(actor.id, "template_updated", { chapterId: t.chapterId, subjectType: "template", subjectId: templateId });
  return getTemplate(templateId);
}

/** Packages of this template assembled (in any state) during the current local week of the chapter. */
export function assembledThisWeek(chapterId: string, templateId: string, at: Date = nowDate()): number {
  const tz = getChapter(chapterId).timezone;
  const from = zonedToUtc(weekStart(localDate(tz, at)), "00:00", tz).toISOString();
  const to = zonedToUtc(addDays(weekStart(localDate(tz, at)), 7), "00:00", tz).toISOString();
  const r = getDb().prepare("SELECT COUNT(*) AS n FROM package WHERE chapter_id = ? AND template_id = ? AND assembled_at >= ? AND assembled_at < ?").get(chapterId, templateId, from, to) as { n: number };
  return r.n;
}

export type DerivedNeed = { itemId: string; target: number; stock: number; shortfall: number };

/**
 * Needs derived from the active templates:
 *   target(item)   = sum over templates of (weekly target - packages already assembled this week) x quantity in the template
 *   shortfall(item) = max(0, target - stock on hand)
 * Packages already assembled this week count toward the weekly target, so assembling a kit does not make the
 * board ask for the same socks again. With nothing assembled yet this is exactly "target packages x contents - stock".
 */
export function deriveTemplateNeeds(chapterId: string, at: Date = nowDate()): DerivedNeed[] {
  const stock = stockByItem(chapterId);
  const target = new Map<string, number>();
  for (const t of listTemplates(chapterId, { activeOnly: true })) {
    const packagesStillNeeded = Math.max(0, t.weeklyTarget - assembledThisWeek(chapterId, t.id, at));
    if (packagesStillNeeded === 0) continue;
    for (const i of t.items) target.set(i.itemId, (target.get(i.itemId) ?? 0) + packagesStillNeeded * i.quantity);
  }
  return [...target.entries()].map(([itemId, tgt]) => {
    const s = stock.get(itemId) ?? 0;
    return { itemId, target: tgt, stock: s, shortfall: Math.max(0, tgt - s) };
  });
}

/**
 * Keeps one standing `need` row per derived item so pledges have something to point at. Idempotent and only
 * writes when something changed, so it is safe to call whenever templates, stock or packages change.
 */
export function syncTemplateNeeds(chapterId: string) {
  const db = getDb();
  const derived = new Map(deriveTemplateNeeds(chapterId).map((d) => [d.itemId, d]));
  const rows = db.prepare("SELECT id, item_id AS itemId, quantity, status FROM need WHERE chapter_id = ? AND source = 'template'").all(chapterId) as { id: string; itemId: string; quantity: number; status: string }[];
  const byItem = new Map(rows.map((r) => [r.itemId, r]));
  for (const [itemId, d] of derived) {
    const status = d.shortfall > 0 ? "open" : "met";
    const row = byItem.get(itemId);
    if (!row) {
      db.prepare("INSERT INTO need (id, chapter_id, item_id, source, quantity, priority, note, status, created_by, created_at, updated_at) VALUES (?,?,?,'template',?,'normal','',?,NULL,?,?)").run(uid(), chapterId, itemId, d.target, status, now(), now());
    } else if (row.quantity !== d.target || row.status !== status) {
      db.prepare("UPDATE need SET quantity = ?, status = ?, updated_at = ? WHERE id = ?").run(d.target, status, now(), row.id);
    }
  }
  for (const row of rows) {
    if (!derived.has(row.itemId) && (row.quantity !== 0 || row.status !== "closed")) {
      db.prepare("UPDATE need SET quantity = 0, status = 'closed', updated_at = ? WHERE id = ?").run(now(), row.id);
    }
  }
}
