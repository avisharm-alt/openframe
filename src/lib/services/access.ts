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
