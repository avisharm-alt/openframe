import { getDb, now, uid } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { assembleSchema, kitTemplatePatchSchema, kitTemplateSchema } from "../validation";
import type { Actor, ItemCategory } from "../types";
import { logAudit } from "./audit";
import { requireCoordinator } from "./access";
import { getItem, normalizeSize } from "./items";
import { syncRestock } from "./restock";
import { appendLedger, stockMap, stockKey } from "./stock";

export type KitTemplateItem = { itemId: string; name: string; unit: string; category: ItemCategory; size: string; quantity: number };
export type KitTemplate = { id: string; chapterId: string; name: string; description: string; active: boolean; items: KitTemplateItem[] };
type TRow = { id: string; chapter_id: string; name: string; description: string; active: number };

function load(r: TRow): KitTemplate {
  const items = getDb()
    .prepare(
      `SELECT ti.item_id AS itemId, i.name, i.unit, i.category, ti.size, ti.quantity FROM kit_template_item ti JOIN item i ON i.id = ti.item_id
        WHERE ti.template_id = ? ORDER BY i.category, i.name, ti.size`,
    )
    .all(r.id) as KitTemplateItem[];
  return { id: r.id, chapterId: r.chapter_id, name: r.name, description: r.description, active: !!r.active, items };
}
export function listKitTemplates(chapterId: string, opts: { activeOnly?: boolean } = {}): KitTemplate[] {
  return (getDb().prepare(`SELECT * FROM kit_template WHERE chapter_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY name`).all(chapterId) as TRow[]).map(load);
}
export function getKitTemplate(id: string): KitTemplate {
  const r = getDb().prepare("SELECT * FROM kit_template WHERE id = ?").get(id) as TRow | undefined;
  if (!r) throw notFound("Kit template not found");
  return load(r);
}

function cleanItems(items: { itemId: string; size: string; quantity: number }[]) {
  const seen = new Set<string>();
  return items.map((i) => {
    const item = getItem(i.itemId);
    if (!item.active) throw invalid("That item is no longer in the catalog.");
    const size = normalizeSize(item, i.size);
    const k = `${item.id}|${size}`;
    if (seen.has(k)) throw invalid("Each item (and size) can appear only once in a kit. Increase its quantity instead.");
    seen.add(k);
    return { itemId: item.id, size, quantity: i.quantity };
  });
}

export function createKitTemplate(actor: Actor, chapterId: string, raw: unknown): KitTemplate {
  requireCoordinator(actor, chapterId);
  const input = kitTemplateSchema.parse(raw);
  const items = cleanItems(input.items);
  const db = getDb();
  if (db.prepare("SELECT 1 FROM kit_template WHERE chapter_id = ? AND name = ?").get(chapterId, input.name)) throw conflict("template_exists", "A kit template with that name already exists in this chapter.");
  const id = uid();
  db.transaction(() => {
    db.prepare("INSERT INTO kit_template (id, chapter_id, name, description, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(id, chapterId, input.name, input.description, input.active ? 1 : 0, now(), now());
    for (const i of items) db.prepare("INSERT INTO kit_template_item (template_id, item_id, size, quantity) VALUES (?,?,?,?)").run(id, i.itemId, i.size, i.quantity);
  })();
  logAudit(actor.id, "kit_template_created", { chapterId, subjectType: "kit_template", subjectId: id });
  return getKitTemplate(id);
}

export function updateKitTemplate(actor: Actor, templateId: string, raw: unknown): KitTemplate {
  const t = getKitTemplate(templateId);
  requireCoordinator(actor, t.chapterId);
  const p = kitTemplatePatchSchema.parse(raw);
  const items = p.items ? cleanItems(p.items) : null;
  const db = getDb();
  if (p.name && p.name !== t.name && db.prepare("SELECT 1 FROM kit_template WHERE chapter_id = ? AND name = ?").get(t.chapterId, p.name)) throw conflict("template_exists", "A kit template with that name already exists in this chapter.");
  db.transaction(() => {
    db.prepare("UPDATE kit_template SET name = ?, description = ?, active = ?, updated_at = ? WHERE id = ?").run(p.name ?? t.name, p.description ?? t.description, (p.active ?? t.active) ? 1 : 0, now(), templateId);
    if (items) {
      db.prepare("DELETE FROM kit_template_item WHERE template_id = ?").run(templateId);
      for (const i of items) db.prepare("INSERT INTO kit_template_item (template_id, item_id, size, quantity) VALUES (?,?,?,?)").run(templateId, i.itemId, i.size, i.quantity);
    }
  })();
  logAudit(actor.id, "kit_template_updated", { chapterId: t.chapterId, subjectType: "kit_template", subjectId: templateId });
  return getKitTemplate(templateId);
}

export type Assemblable = { templateId: string; name: string; maxKits: number; assembled: number; missing: { itemId: string; name: string; size: string; short: number }[] };

/** For each active template: how many kits current stock can fully assemble, what is short for the next one, and how many are already assembled. */
export function listAssemblable(actor: Actor, chapterId: string): Assemblable[] {
  requireCoordinator(actor, chapterId);
  const stock = stockMap(chapterId);
  return listKitTemplates(chapterId, { activeOnly: true }).map((t) => {
    const have = (i: KitTemplateItem) => stock.get(stockKey(i.itemId, i.size)) ?? 0;
    const max = t.items.length ? Math.min(...t.items.map((i) => Math.floor(have(i) / i.quantity))) : 0;
    const missing = t.items.map((i) => ({ itemId: i.itemId, name: i.name, size: i.size, short: Math.max(0, i.quantity * (max + 1) - have(i)) })).filter((m) => m.short > 0);
    const assembled = (getDb().prepare("SELECT COUNT(*) AS n FROM kit WHERE template_id = ? AND status = 'assembled'").get(t.id) as { n: number }).n;
    return { templateId: t.id, name: t.name, maxKits: max, assembled, missing };
  });
}

/**
 * Assembles `count` ready-made kits from a template. ONE transaction: each kit, its contents snapshot and the stock
 * decrements. If any item is short, nothing is written.
 */
export function assembleKits(actor: Actor, chapterId: string, raw: unknown) {
  requireCoordinator(actor, chapterId);
  const input = assembleSchema.parse(raw);
  const t = getKitTemplate(input.templateId);
  if (t.chapterId !== chapterId) throw notFound("Kit template not found");
  if (!t.active) throw conflict("template_inactive", "That kit template is not active.");
  const db = getDb();
  const ids: string[] = [];
  db.transaction(() => {
    const stock = stockMap(chapterId);
    const short = t.items.filter((i) => (stock.get(stockKey(i.itemId, i.size)) ?? 0) < i.quantity * input.count);
    if (short.length) {
      throw conflict("insufficient_stock", `Not enough stock to assemble ${input.count} × ${t.name}.`, short.map((i) => ({ item: i.name, size: i.size, have: stock.get(stockKey(i.itemId, i.size)) ?? 0, need: i.quantity * input.count })));
    }
    for (let n = 0; n < input.count; n++) {
      const id = uid();
      ids.push(id);
      db.prepare("INSERT INTO kit (id, chapter_id, template_id, template_name, status, assembled_by, assembled_at) VALUES (?,?,?,?,'assembled',?,?)").run(id, chapterId, t.id, t.name, actor.id, now());
      for (const i of t.items) {
        db.prepare("INSERT INTO kit_item (kit_id, item_id, size, quantity) VALUES (?,?,?,?)").run(id, i.itemId, i.size, i.quantity);
        appendLedger({ chapterId, itemId: i.itemId, size: i.size, delta: -i.quantity, kind: "assembled_into_kit", kitId: id, actorId: actor.id });
      }
    }
    syncRestock(chapterId);
  })();
  logAudit(actor.id, "kits_assembled", { chapterId, subjectType: "kit_template", subjectId: t.id, detail: { count: input.count } });
  return { kitIds: ids };
}

export const assembledKitCount = (chapterId: string, templateId: string): number =>
  (getDb().prepare("SELECT COUNT(*) AS n FROM kit WHERE chapter_id = ? AND template_id = ? AND status = 'assembled'").get(chapterId, templateId) as { n: number }).n;

/** Allocates the oldest assembled kits of a template to a kit request. Caller runs it in a transaction. */
export function allocateKits(chapterId: string, templateId: string, requestId: string, count: number) {
  const db = getDb();
  const ids = db.prepare("SELECT id FROM kit WHERE chapter_id = ? AND template_id = ? AND status = 'assembled' ORDER BY assembled_at, rowid LIMIT ?").all(chapterId, templateId, count) as { id: string }[];
  if (ids.length < count) throw conflict("insufficient_kits", `Only ${ids.length} assembled ${ids.length === 1 ? "kit is" : "kits are"} on the shelf; ${count} are needed. Assemble more first.`);
  for (const k of ids) db.prepare("UPDATE kit SET status = 'allocated', request_id = ? WHERE id = ?").run(requestId, k.id);
}
