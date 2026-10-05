import { getDb } from "../db";
import { forbidden, notFound } from "../errors";
import { isAdmin, type Actor, type ChapterRole } from "../types";

export type Chapter = { id: string; slug: string; name: string; city: string; timezone: string; active: boolean };
type ChapterRow = Omit<Chapter, "active"> & { active: number };
const toChapter = (r: ChapterRow): Chapter => ({ ...r, active: !!r.active });

export function getChapterBySlug(slug: string): Chapter {
  const r = getDb().prepare("SELECT id, slug, name, city, timezone, active FROM chapter WHERE slug = ?").get(slug) as ChapterRow | undefined;
  if (!r) throw notFound("Chapter not found");
  return toChapter(r);
}
export function getChapter(id: string): Chapter {
  const r = getDb().prepare("SELECT id, slug, name, city, timezone, active FROM chapter WHERE id = ?").get(id) as ChapterRow | undefined;
  if (!r) throw notFound("Chapter not found");
  return toChapter(r);
}

/** The user's role inside one chapter, or null. Always read from the database, never from the request. */
export function chapterRoleOf(userId: string, chapterId: string): ChapterRole | null {
  const r = getDb().prepare("SELECT role FROM chapter_member WHERE chapter_id = ? AND user_id = ?").get(chapterId, userId) as { role: ChapterRole } | undefined;
  return r?.role ?? null;
}

/** Admins can coordinate every chapter. A chapter coordinator can coordinate only that chapter. */
export function isCoordinatorOf(actor: Actor, chapterId: string): boolean {
  return isAdmin(actor) || chapterRoleOf(actor.id, chapterId) === "coordinator";
}
/** Volunteers and coordinators of the chapter. Admins are not volunteers unless they are chapter members. */
export function isVolunteerOf(actor: Actor, chapterId: string): boolean {
  const r = chapterRoleOf(actor.id, chapterId);
  return r === "volunteer" || r === "coordinator";
}
export function isCoordinatorAnywhere(actor: Actor): boolean {
  if (isAdmin(actor)) return true;
  return !!getDb().prepare("SELECT 1 FROM chapter_member WHERE user_id = ? AND role = 'coordinator' LIMIT 1").get(actor.id);
}

export function requireCoordinator(actor: Actor, chapterId: string) {
  if (!isCoordinatorOf(actor, chapterId)) throw forbidden("Coordinator access for this chapter is required.");
}
export function requireVolunteer(actor: Actor, chapterId: string) {
  if (!isVolunteerOf(actor, chapterId)) throw forbidden("Volunteer access for this chapter is required.");
}
export function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw forbidden("Admin access required.");
}

export type Membership = { chapterId: string; slug: string; name: string; role: ChapterRole };
/** The chapters a user belongs to. Admins are listed separately by the caller (they can coordinate any chapter). */
export function listMemberships(userId: string): Membership[] {
  return getDb()
    .prepare(
      `SELECT c.id AS chapterId, c.slug, c.name, m.role FROM chapter_member m JOIN chapter c ON c.id = m.chapter_id
        WHERE m.user_id = ? ORDER BY c.name`,
    )
    .all(userId) as Membership[];
}

// ---- partners: the agency_worker role is scoped to one partner --------------------------------------------------------

export type PartnerRef = { id: string; chapterId: string; name: string; status: "pending" | "approved" | "suspended"; active: boolean };
export function getPartnerRef(id: string): PartnerRef {
  const r = getDb().prepare("SELECT id, chapter_id AS chapterId, name, status, active FROM partner WHERE id = ?").get(id) as (Omit<PartnerRef, "active"> & { active: number }) | undefined;
  if (!r) throw notFound("Partner not found");
  return { ...r, active: !!r.active };
}

/** An approved agency worker of an approved, active partner. Pending workers have no access. */
export function isAgencyWorkerOf(actor: Actor, partnerId: string): boolean {
  const r = getDb()
    .prepare(
      `SELECT 1 FROM partner_member m JOIN partner p ON p.id = m.partner_id
        WHERE m.partner_id = ? AND m.user_id = ? AND m.status = 'approved' AND p.status = 'approved' AND p.active = 1`,
    )
    .get(partnerId, actor.id);
  return !!r;
}
export function requireAgencyWorker(actor: Actor, partnerId: string) {
  if (!isAgencyWorkerOf(actor, partnerId)) throw forbidden("Agency worker access for this partner is required.");
}
/** Workers of the partner, or coordinators of the partner's chapter (and admins). */
export function canActForPartner(actor: Actor, partnerId: string): boolean {
  return isAgencyWorkerOf(actor, partnerId) || isCoordinatorOf(actor, getPartnerRef(partnerId).chapterId);
}

export type PartnerMembership = { partnerId: string; name: string; chapterSlug: string; status: "pending" | "approved"; partnerStatus: string };
export function listPartnerMemberships(userId: string): PartnerMembership[] {
  return getDb()
    .prepare(
      `SELECT p.id AS partnerId, p.name, c.slug AS chapterSlug, m.status, p.status AS partnerStatus
         FROM partner_member m JOIN partner p ON p.id = m.partner_id JOIN chapter c ON c.id = p.chapter_id WHERE m.user_id = ? ORDER BY p.name`,
    )
    .all(userId) as PartnerMembership[];
}
