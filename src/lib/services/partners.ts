import { getDb, now, uid } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { rateLimit } from "../ratelimit";
import { decisionSchema, partnerApplySchema, partnerPatchSchema, partnerSchema, sitePatchSchema, siteSchema } from "../validation";
import type { Actor } from "../types";
import { logAudit } from "./audit";
import { canActForPartner, getChapterBySlug, getPartnerRef, requireCoordinator } from "./access";

export type Partner = { id: string; chapterId: string; name: string; description: string; excludedItems: string; status: "pending" | "approved" | "suspended"; active: boolean };
type PRow = { id: string; chapter_id: string; name: string; description: string; excluded_items: string; status: Partner["status"]; active: number };
const toPartner = (r: PRow): Partner => ({ id: r.id, chapterId: r.chapter_id, name: r.name, description: r.description, excludedItems: r.excluded_items, status: r.status, active: !!r.active });

export function getPartner(id: string): Partner {
  const r = getDb().prepare("SELECT * FROM partner WHERE id = ?").get(id) as PRow | undefined;
  if (!r) throw notFound("Partner not found");
  return toPartner(r);
}
/** Approved, active partners of a chapter: what neighbours see. */
export function listPartners(chapterId: string, opts: { all?: boolean } = {}): Partner[] {
  const rows = getDb().prepare(`SELECT * FROM partner WHERE chapter_id = ? ${opts.all ? "" : "AND status = 'approved' AND active = 1"} ORDER BY name`).all(chapterId) as PRow[];
  return rows.map(toPartner);
}

// ---- delivery sites: agency buildings, public name + address + receiving hours ------------------------------------------------
export type Site = { id: string; partnerId: string; name: string; address: string; receivingHours: string; active: boolean };
type SRow = { id: string; partner_id: string; name: string; address: string; receiving_hours: string; active: number };
const toSite = (r: SRow): Site => ({ id: r.id, partnerId: r.partner_id, name: r.name, address: r.address, receivingHours: r.receiving_hours, active: !!r.active });
export function getSite(id: string): Site {
  const r = getDb().prepare("SELECT * FROM delivery_site WHERE id = ?").get(id) as SRow | undefined;
  if (!r) throw notFound("Delivery site not found");
  return toSite(r);
}
export function listSites(partnerId: string, opts: { activeOnly?: boolean } = {}): Site[] {
  return (getDb().prepare(`SELECT * FROM delivery_site WHERE partner_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY name`).all(partnerId) as SRow[]).map(toSite);
}

// ---- partner management (coordinators) -----------------------------------------------------------------------------------------
/** A coordinator adds a verified partner directly. */
export function createPartner(actor: Actor, chapterId: string, raw: unknown): Partner {
  requireCoordinator(actor, chapterId);
  const input = partnerSchema.parse(raw);
  const id = uid();
  getDb().prepare("INSERT INTO partner (id, chapter_id, name, description, excluded_items, status, active, created_at) VALUES (?,?,?,?,?,'approved',1,?)").run(id, chapterId, input.name, input.description, input.excludedItems, now());
  logAudit(actor.id, "partner_created", { chapterId, subjectType: "partner", subjectId: id });
  return getPartner(id);
}

/** Anyone signed in can apply to be a partner. The partner is pending until a coordinator verifies it; the applicant becomes its pending worker. */
export function applyPartner(actor: Actor, raw: unknown): Partner {
  rateLimit(`partner-apply:${actor.id}`, 3, 24 * 3600_000);
  const input = partnerApplySchema.parse(raw);
  const chapter = getChapterBySlug(input.chapter);
  const db = getDb();
  const id = uid();
  db.transaction(() => {
    db.prepare("INSERT INTO partner (id, chapter_id, name, description, excluded_items, status, active, created_at) VALUES (?,?,?,?,'','pending',1,?)").run(id, chapter.id, input.name, input.description, now());
    db.prepare("INSERT INTO partner_member (partner_id, user_id, role, status, requested_at) VALUES (?,?,'agency_worker','pending',?)").run(id, actor.id, now());
  })();
  logAudit(actor.id, "partner_applied", { chapterId: chapter.id, subjectType: "partner", subjectId: id });
  return getPartner(id);
}

export function updatePartner(actor: Actor, partnerId: string, raw: unknown): Partner {
  const p = getPartner(partnerId);
  requireCoordinator(actor, p.chapterId);
  const x = partnerPatchSchema.parse(raw);
  getDb().prepare("UPDATE partner SET name = ?, description = ?, excluded_items = ?, active = ? WHERE id = ?").run(x.name ?? p.name, x.description ?? p.description, x.excludedItems ?? p.excludedItems, (x.active ?? p.active) ? 1 : 0, partnerId);
  logAudit(actor.id, "partner_updated", { chapterId: p.chapterId, subjectType: "partner", subjectId: partnerId });
  return getPartner(partnerId);
}

/** Verify (approve), suspend or reject a partner. A rejected pending partner is removed. */
export function decidePartner(actor: Actor, partnerId: string, raw: unknown) {
  const p = getPartner(partnerId);
  requireCoordinator(actor, p.chapterId);
  const { decision } = decisionSchema.parse(raw);
  const db = getDb();
  if (decision === "rejected") {
    if (p.status !== "pending") throw conflict("not_pending", "Only a pending partner can be rejected. Suspend it instead.");
    db.prepare("DELETE FROM partner WHERE id = ?").run(partnerId);
  } else {
    db.transaction(() => {
      db.prepare("UPDATE partner SET status = ? WHERE id = ?").run(decision, partnerId);
      // Verifying a new partner also verifies the person who applied for it.
      if (decision === "approved" && p.status === "pending") db.prepare("UPDATE partner_member SET status = 'approved', decided_by = ?, decided_at = ? WHERE partner_id = ?").run(actor.id, now(), partnerId);
    })();
  }
  logAudit(actor.id, `partner_${decision}`, { chapterId: p.chapterId, subjectType: "partner", subjectId: partnerId });
}

export function createSite(actor: Actor, partnerId: string, raw: unknown): Site {
  const p = getPartner(partnerId);
  requireCoordinator(actor, p.chapterId);
  const input = siteSchema.parse(raw);
  const id = uid();
  getDb().prepare("INSERT INTO delivery_site (id, partner_id, name, address, receiving_hours, active, created_at) VALUES (?,?,?,?,?,?,?)").run(id, partnerId, input.name, input.address, input.receivingHours, input.active ? 1 : 0, now());
  logAudit(actor.id, "site_created", { chapterId: p.chapterId, subjectType: "site", subjectId: id });
  return getSite(id);
}
export function updateSite(actor: Actor, siteId: string, raw: unknown): Site {
  const s = getSite(siteId);
  const p = getPartner(s.partnerId);
  requireCoordinator(actor, p.chapterId);
  const x = sitePatchSchema.parse(raw);
  getDb().prepare("UPDATE delivery_site SET name = ?, address = ?, receiving_hours = ?, active = ? WHERE id = ?").run(x.name ?? s.name, x.address ?? s.address, x.receivingHours ?? s.receivingHours, (x.active ?? s.active) ? 1 : 0, siteId);
  logAudit(actor.id, "site_updated", { chapterId: p.chapterId, subjectType: "site", subjectId: siteId });
  return getSite(siteId);
}

// ---- agency workers: sign up, request access to a partner, a coordinator approves -----------------------------------------------
export function requestAccess(actor: Actor, partnerId: string) {
  rateLimit(`partner-access:${actor.id}`, 5, 24 * 3600_000);
  const p = getPartner(partnerId);
  if (p.status !== "approved" || !p.active) throw notFound("Partner not found");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM partner_member WHERE partner_id = ? AND user_id = ?").get(partnerId, actor.id)) throw conflict("already_requested", "You have already asked for access to this partner.");
  db.prepare("INSERT INTO partner_member (partner_id, user_id, role, status, requested_at) VALUES (?,?,'agency_worker','pending',?)").run(partnerId, actor.id, now());
  logAudit(actor.id, "partner_access_requested", { chapterId: p.chapterId, subjectType: "partner", subjectId: partnerId });
}

export type Worker = { userId: string; name: string; email: string; status: "pending" | "approved"; requestedAt: string };
export type PendingApprovals = { partners: (Partner & { applicants: string[] })[]; workers: (Worker & { partnerId: string; partnerName: string })[] };

/** Everything waiting for a coordinator's verification: new partners, and workers asking to join approved partners. */
export function listApprovals(actor: Actor, chapterId: string): PendingApprovals {
  requireCoordinator(actor, chapterId);
  const db = getDb();
  const partners = (db.prepare("SELECT * FROM partner WHERE chapter_id = ? AND status = 'pending' ORDER BY created_at").all(chapterId) as PRow[]).map((r) => ({
    ...toPartner(r),
    applicants: (db.prepare('SELECT u.name FROM partner_member m JOIN "user" u ON u.id = m.user_id WHERE m.partner_id = ?').all(r.id) as { name: string }[]).map((a) => a.name),
  }));
  const workers = db
    .prepare(
      `SELECT m.partner_id AS partnerId, p.name AS partnerName, m.user_id AS userId, u.name, u.email, m.status, m.requested_at AS requestedAt
         FROM partner_member m JOIN partner p ON p.id = m.partner_id JOIN "user" u ON u.id = m.user_id
        WHERE p.chapter_id = ? AND p.status = 'approved' AND m.status = 'pending' ORDER BY m.requested_at`,
    )
    .all(chapterId) as (Worker & { partnerId: string; partnerName: string })[];
  return { partners, workers };
}

export function listWorkers(actor: Actor, partnerId: string): Worker[] {
  requireCoordinator(actor, getPartnerRef(partnerId).chapterId);
  return getDb()
    .prepare(
      `SELECT m.user_id AS userId, u.name, u.email, m.status, m.requested_at AS requestedAt FROM partner_member m JOIN "user" u ON u.id = m.user_id WHERE m.partner_id = ? ORDER BY m.status, u.name`,
    )
    .all(partnerId) as Worker[];
}

/** A coordinator approves or rejects a worker for a partner in their own chapter. Approving needs the partner to be verified first. */
export function decideWorker(actor: Actor, partnerId: string, userId: string, raw: unknown) {
  const p = getPartner(partnerId);
  requireCoordinator(actor, p.chapterId);
  const { decision } = decisionSchema.parse(raw);
  const db = getDb();
  const m = db.prepare("SELECT status FROM partner_member WHERE partner_id = ? AND user_id = ?").get(partnerId, userId) as { status: string } | undefined;
  if (!m) throw notFound("That person has not asked for access to this partner.");
  if (decision === "approved") {
    if (p.status !== "approved") throw invalid("Verify the partner before approving its workers.");
    db.prepare("UPDATE partner_member SET status = 'approved', decided_by = ?, decided_at = ? WHERE partner_id = ? AND user_id = ?").run(actor.id, now(), partnerId, userId);
  } else {
    db.prepare("DELETE FROM partner_member WHERE partner_id = ? AND user_id = ?").run(partnerId, userId);
  }
  logAudit(actor.id, `worker_${decision === "approved" ? "approved" : "removed"}`, { chapterId: p.chapterId, subjectType: "user", subjectId: userId, detail: { partnerId } });
}

/** Sites a worker (or coordinator) of the partner can post requests to. */
export function listSitesFor(actor: Actor, partnerId: string): Site[] {
  if (!canActForPartner(actor, partnerId)) throw forbidden("Agency worker access for this partner is required.");
  return listSites(partnerId, { activeOnly: true });
}

/** Everything a chapter's coordinators manage about partners: all partners (any status) with their sites and workers. */
export function listPartnersAdmin(actor: Actor, chapterId: string) {
  requireCoordinator(actor, chapterId);
  return listPartners(chapterId, { all: true }).map((p) => ({
    ...p,
    sites: listSites(p.id),
    workers: getDb().prepare('SELECT m.user_id AS userId, u.name, u.email, m.status FROM partner_member m JOIN "user" u ON u.id = m.user_id WHERE m.partner_id = ? ORDER BY m.status, u.name').all(p.id) as { userId: string; name: string; email: string; status: string }[],
  }));
}
