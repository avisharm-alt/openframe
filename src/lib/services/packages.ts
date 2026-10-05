import { getDb, now, uid } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { assembleSchema, handoffSchema } from "../validation";
import type { Actor } from "../types";
import { localDate, addDays } from "../time";
import { logAudit } from "./audit";
import { getChapter, requireCoordinator } from "./access";
import { appendLedger, stockByItem } from "./inventory";
import { getPartner } from "./partners";
import { getTemplate, listTemplates, syncTemplateNeeds } from "./templates";

export type Assemblable = { templateId: string; name: string; maxPackages: number; missing: { itemId: string; name: string; short: number }[] };

/** For each active template: how many packages current stock can fully assemble, and what is short for the next one. */
export function listAssemblable(actor: Actor, chapterId: string): Assemblable[] {
  requireCoordinator(actor, chapterId);
  const stock = stockByItem(chapterId);
  return listTemplates(chapterId, { activeOnly: true }).map((t) => {
    const max = t.items.length ? Math.min(...t.items.map((i) => Math.floor((stock.get(i.itemId) ?? 0) / i.quantity))) : 0;
    const missing = t.items
      .map((i) => ({ itemId: i.itemId, name: i.name, short: Math.max(0, i.quantity * (max + 1) - (stock.get(i.itemId) ?? 0)) }))
      .filter((m) => m.short > 0);
    return { templateId: t.id, name: t.name, maxPackages: max, missing };
  });
}

/**
 * Assembles `count` packages from a template. Everything happens in ONE transaction: each package, its contents
 * snapshot and the ledger decrements. If any item is short, nothing is written.
 */
export function assemblePackages(actor: Actor, chapterId: string, raw: unknown) {
  requireCoordinator(actor, chapterId);
  const input = assembleSchema.parse(raw);
  const t = getTemplate(input.templateId);
  if (t.chapterId !== chapterId) throw notFound("Package template not found");
  if (!t.active) throw conflict("template_inactive", "That template is not active.");
  const db = getDb();
  const ids: string[] = [];
  db.transaction(() => {
    const stock = stockByItem(chapterId);
    const short = t.items.filter((i) => (stock.get(i.itemId) ?? 0) < i.quantity * input.count);
    if (short.length) {
      throw conflict("insufficient_stock", `Not enough stock to assemble ${input.count} × ${t.name}.`, short.map((i) => ({ item: i.name, have: stock.get(i.itemId) ?? 0, need: i.quantity * input.count })));
    }
    for (let n = 0; n < input.count; n++) {
      const id = uid();
      ids.push(id);
      db.prepare("INSERT INTO package (id, chapter_id, template_id, template_name, status, assembled_by, assembled_at) VALUES (?,?,?,?, 'assembled', ?, ?)").run(id, chapterId, t.id, t.name, actor.id, now());
      for (const i of t.items) {
        db.prepare("INSERT INTO package_item (package_id, item_id, quantity) VALUES (?,?,?)").run(id, i.itemId, i.quantity);
        appendLedger({ chapterId, itemId: i.itemId, delta: -i.quantity, kind: "assembled_into_package", packageId: id, actorId: actor.id });
      }
    }
    syncTemplateNeeds(chapterId);
  })();
  logAudit(actor.id, "packages_assembled", { chapterId, subjectType: "template", subjectId: t.id, detail: { count: input.count } });
  return { packageIds: ids };
}

export type PackageRow = { id: string; templateName: string; status: "assembled" | "handed_off"; agencyName: string | null; handedOffOn: string | null; assembledAt: string };

export function listPackages(actor: Actor, chapterId: string, status?: "assembled" | "handed_off", limit = 100): PackageRow[] {
  requireCoordinator(actor, chapterId);
  return getDb()
    .prepare(
      `SELECT p.id, p.template_name AS templateName, p.status, a.name AS agencyName, p.handed_off_on AS handedOffOn, p.assembled_at AS assembledAt
         FROM package p LEFT JOIN partner_agency a ON a.id = p.agency_id
        WHERE p.chapter_id = ? ${status ? "AND p.status = ?" : ""} ORDER BY p.assembled_at DESC, p.rowid DESC LIMIT ?`,
    )
    .all(...(status ? [chapterId, status, limit] : [chapterId, limit])) as PackageRow[];
}

/**
 * Hands assembled packages to a partner agency on a date. The record is the agency and the date, nothing else:
 * there is deliberately no field for anything about the people who receive the packages.
 */
export function handOffPackages(actor: Actor, chapterId: string, raw: unknown) {
  requireCoordinator(actor, chapterId);
  const input = handoffSchema.parse(raw);
  const agency = getPartner(input.agencyId);
  if (agency.chapterId !== chapterId) throw notFound("Partner agency not found");
  if (!agency.active || !agency.acceptsPackages) throw conflict("agency_not_accepting", "That partner is not accepting packages right now.");
  const tz = getChapter(chapterId).timezone;
  const today = localDate(tz);
  if (input.date > today) throw invalid("The hand-off date cannot be in the future.");
  if (input.date < addDays(today, -60)) throw invalid("The hand-off date is too far in the past.");
  const db = getDb();
  const unique = [...new Set(input.packageIds)];
  db.transaction(() => {
    for (const id of unique) {
      const r = db.prepare("UPDATE package SET status = 'handed_off', agency_id = ?, handed_off_on = ?, handed_off_by = ? WHERE id = ? AND chapter_id = ? AND status = 'assembled'").run(agency.id, input.date, actor.id, id, chapterId);
      if (r.changes !== 1) throw conflict("package_unavailable", "One of those packages does not exist in this chapter or was already handed off.");
    }
  })();
  logAudit(actor.id, "packages_handed_off", { chapterId, subjectType: "partner", subjectId: agency.id, detail: { count: unique.length, date: input.date } });
  return { handedOff: unique.length };
}
