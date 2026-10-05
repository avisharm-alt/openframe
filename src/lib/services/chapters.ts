import { z } from "zod";
import { getDb, now, uid } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { chapterSchema, memberSchema, partnerPatchSchema, partnerSchema, zonePatchSchema, zoneSchema } from "../validation";
import { isAdmin, type Actor, type ChapterRole } from "../types";
import { logAudit } from "./audit";
import { getChapter, requireAdmin, requireCoordinator, chapterRoleOf, type Chapter } from "./access";

// ---- chapters ----------------------------------------------------------------------------------------------------

export function listChapters(opts: { includeInactive?: boolean } = {}): Chapter[] {
  const rows = getDb()
    .prepare(`SELECT id, slug, name, city, timezone, active FROM chapter ${opts.includeInactive ? "" : "WHERE active = 1"} ORDER BY name`)
    .all() as (Omit<Chapter, "active"> & { active: number })[];
  return rows.map((r) => ({ ...r, active: !!r.active }));
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Chapters are data: any campus can be added without a code change. Admin only. */
export function createChapter(actor: Actor, raw: z.input<typeof chapterSchema>): Chapter {
  requireAdmin(actor);
  const input = chapterSchema.parse(raw);
  const slug = input.slug ?? slugify(input.city.replace(/,.*$/, ""));
  if (slug.length < 2) throw invalid("Could not make a short name for the web address. Provide a slug.");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM chapter WHERE slug = ?").get(slug)) throw conflict("slug_taken", `A chapter with the address “${slug}” already exists.`);
  const id = uid();
  db.prepare("INSERT INTO chapter (id, slug, name, city, timezone, active, created_at) VALUES (?,?,?,?,?,1,?)").run(id, slug, input.name, input.city, input.timezone, now());
  logAudit(actor.id, "chapter_created", { chapterId: id, subjectType: "chapter", subjectId: id, detail: { slug } });
  return getChapter(id);
}

export function setChapterActive(actor: Actor, chapterId: string, active: boolean) {
  requireAdmin(actor);
  getChapter(chapterId);
  getDb().prepare("UPDATE chapter SET active = ? WHERE id = ?").run(active ? 1 : 0, chapterId);
  logAudit(actor.id, active ? "chapter_activated" : "chapter_deactivated", { chapterId, subjectType: "chapter", subjectId: chapterId });
}

// ---- drop-off zones ----------------------------------------------------------------------------------------------

export type Zone = { id: string; chapterId: string; name: string; description: string; hours: string; active: boolean };
type ZoneRow = { id: string; chapter_id: string; name: string; description: string; hours: string; active: number };
const toZone = (r: ZoneRow): Zone => ({ id: r.id, chapterId: r.chapter_id, name: r.name, description: r.description, hours: r.hours, active: !!r.active });

export function listZones(chapterId: string, opts: { activeOnly?: boolean } = {}): Zone[] {
  const rows = getDb()
    .prepare(`SELECT * FROM zone WHERE chapter_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY name`)
    .all(chapterId) as ZoneRow[];
  return rows.map(toZone);
}
export function getZone(id: string): Zone {
  const r = getDb().prepare("SELECT * FROM zone WHERE id = ?").get(id) as ZoneRow | undefined;
  if (!r) throw notFound("Drop-off zone not found");
  return toZone(r);
}

export function createZone(actor: Actor, chapterId: string, raw: unknown): Zone {
  requireCoordinator(actor, chapterId);
  const input = zoneSchema.parse(raw);
  const id = uid();
  getDb().prepare("INSERT INTO zone (id, chapter_id, name, description, hours, active, created_at) VALUES (?,?,?,?,?,?,?)").run(id, chapterId, input.name, input.description, input.hours, input.active ? 1 : 0, now());
  logAudit(actor.id, "zone_created", { chapterId, subjectType: "zone", subjectId: id });
  return getZone(id);
}
export function updateZone(actor: Actor, zoneId: string, raw: unknown): Zone {
  const z = getZone(zoneId);
  requireCoordinator(actor, z.chapterId);
  const p = zonePatchSchema.parse(raw);
  getDb()
    .prepare("UPDATE zone SET name = ?, description = ?, hours = ?, active = ? WHERE id = ?")
    .run(p.name ?? z.name, p.description ?? z.description, p.hours ?? z.hours, (p.active ?? z.active) ? 1 : 0, zoneId);
  logAudit(actor.id, "zone_updated", { chapterId: z.chapterId, subjectType: "zone", subjectId: zoneId });
  return getZone(zoneId);
}

// ---- partner agencies --------------------------------------------------------------------------------------------

export type Partner = { id: string; chapterId: string; name: string; description: string; acceptsPackages: boolean; active: boolean };
type PartnerRow = { id: string; chapter_id: string; name: string; description: string; accepts_packages: number; active: number };
const toPartner = (r: PartnerRow): Partner => ({ id: r.id, chapterId: r.chapter_id, name: r.name, description: r.description, acceptsPackages: !!r.accepts_packages, active: !!r.active });

export function listPartners(chapterId: string, opts: { activeOnly?: boolean } = {}): Partner[] {
  const rows = getDb().prepare(`SELECT * FROM partner_agency WHERE chapter_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY name`).all(chapterId) as PartnerRow[];
  return rows.map(toPartner);
}
export function getPartner(id: string): Partner {
  const r = getDb().prepare("SELECT * FROM partner_agency WHERE id = ?").get(id) as PartnerRow | undefined;
  if (!r) throw notFound("Partner agency not found");
  return toPartner(r);
}
export function createPartner(actor: Actor, chapterId: string, raw: unknown): Partner {
  requireCoordinator(actor, chapterId);
  const input = partnerSchema.parse(raw);
  const id = uid();
  getDb()
    .prepare("INSERT INTO partner_agency (id, chapter_id, name, description, accepts_packages, active, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, chapterId, input.name, input.description, input.acceptsPackages ? 1 : 0, input.active ? 1 : 0, now());
  logAudit(actor.id, "partner_created", { chapterId, subjectType: "partner", subjectId: id });
  return getPartner(id);
}
export function updatePartner(actor: Actor, partnerId: string, raw: unknown): Partner {
  const p = getPartner(partnerId);
  requireCoordinator(actor, p.chapterId);
  const x = partnerPatchSchema.parse(raw);
  getDb()
    .prepare("UPDATE partner_agency SET name = ?, description = ?, accepts_packages = ?, active = ? WHERE id = ?")
    .run(x.name ?? p.name, x.description ?? p.description, (x.acceptsPackages ?? p.acceptsPackages) ? 1 : 0, (x.active ?? p.active) ? 1 : 0, partnerId);
  logAudit(actor.id, "partner_updated", { chapterId: p.chapterId, subjectType: "partner", subjectId: partnerId });
  return getPartner(partnerId);
}

// ---- chapter roles -----------------------------------------------------------------------------------------------

export type Member = { userId: string; name: string; email: string; role: ChapterRole; safetyAcknowledged: boolean; since: string };

/** Roster, for coordinators of that chapter (they need to reach their volunteers, so email is shown to them only). */
export function listMembers(actor: Actor, chapterId: string): Member[] {
  requireCoordinator(actor, chapterId);
  const rows = getDb()
    .prepare(
      `SELECT m.user_id AS userId, u.name, u.email, m.role, m.created_at AS since,
              EXISTS (SELECT 1 FROM safety_ack a WHERE a.user_id = m.user_id AND a.version >= ?) AS ack
         FROM chapter_member m JOIN "user" u ON u.id = m.user_id
        WHERE m.chapter_id = ? ORDER BY m.role, u.name`,
    )
    .all(SAFETY_VERSION, chapterId) as (Omit<Member, "safetyAcknowledged"> & { ack: number })[];
  return rows.map(({ ack, ...r }) => ({ ...r, safetyAcknowledged: !!ack }));
}

/**
 * Grants a chapter role. A coordinator can add and remove volunteers in their own chapter; only an admin can
 * appoint or change coordinators. The target is found by exact email so nobody can browse the user list.
 */
export function setMember(actor: Actor, chapterId: string, raw: unknown): { userId: string; role: ChapterRole } {
  requireCoordinator(actor, chapterId);
  const input = memberSchema.parse(raw);
  if (input.role === "coordinator" && !isAdmin(actor)) throw forbidden("Only an admin can appoint a coordinator.");
  const db = getDb();
  const u = db.prepare('SELECT id FROM "user" WHERE lower(email) = ?').get(input.email) as { id: string } | undefined;
  if (!u) throw notFound("No account with that email. Ask them to sign in to OpenFrame once first.");
  const existing = chapterRoleOf(u.id, chapterId);
  if (existing === "coordinator" && !isAdmin(actor)) throw forbidden("Only an admin can change a coordinator.");
  db.prepare(
    "INSERT INTO chapter_member (chapter_id, user_id, role, granted_by, created_at) VALUES (?,?,?,?,?) ON CONFLICT (chapter_id, user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by",
  ).run(chapterId, u.id, input.role, actor.id, now());
  logAudit(actor.id, "chapter_role_set", { chapterId, subjectType: "user", subjectId: u.id, detail: { role: input.role, previous: existing } });
  return { userId: u.id, role: input.role };
}

export function removeMember(actor: Actor, chapterId: string, userId: string) {
  requireCoordinator(actor, chapterId);
  const existing = chapterRoleOf(userId, chapterId);
  if (!existing) throw notFound("That person is not a member of this chapter.");
  if (existing === "coordinator" && !isAdmin(actor)) throw forbidden("Only an admin can remove a coordinator.");
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM chapter_member WHERE chapter_id = ? AND user_id = ?").run(chapterId, userId);
    releaseOpenAssignments(userId, chapterId);
  })();
  logAudit(actor.id, "chapter_role_removed", { chapterId, subjectType: "user", subjectId: userId, detail: { previous: existing } });
}

// A removed volunteer must not keep open assignments. Implemented in pickups.ts (registered to avoid a cycle).
let releaseHook: (userId: string, chapterId: string | null) => void = () => {};
export function registerAssignmentRelease(fn: (userId: string, chapterId: string | null) => void) {
  releaseHook = fn;
}
function releaseOpenAssignments(userId: string, chapterId: string | null) {
  releaseHook(userId, chapterId);
}

// ---- safety acknowledgement --------------------------------------------------------------------------------------

/** Bump this when the Safety page changes materially: volunteers then have to acknowledge it again. */
export const SAFETY_VERSION = 1;

export function acknowledgeSafety(actor: Actor): { acknowledgedAt: string } {
  const at = now();
  getDb().prepare("INSERT INTO safety_ack (user_id, version, acknowledged_at) VALUES (?,?,?) ON CONFLICT (user_id, version) DO NOTHING").run(actor.id, SAFETY_VERSION, at);
  logAudit(actor.id, "safety_acknowledged", { subjectType: "user", subjectId: actor.id, detail: { version: SAFETY_VERSION } });
  return { acknowledgedAt: safetyAcknowledgedAt(actor.id) ?? at };
}
export function safetyAcknowledgedAt(userId: string): string | null {
  const r = getDb().prepare("SELECT acknowledged_at AS at FROM safety_ack WHERE user_id = ? AND version >= ? ORDER BY version DESC LIMIT 1").get(userId, SAFETY_VERSION) as { at: string } | undefined;
  return r?.at ?? null;
}
