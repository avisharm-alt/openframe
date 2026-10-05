import { z } from "zod";
import { getDb, now, uid } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { chapterSchema, memberSchema } from "../validation";
import { isAdmin, type Actor, type ChapterRole } from "../types";
import { logAudit } from "./audit";
import { getChapter, requireAdmin, requireCoordinator, chapterRoleOf, type Chapter } from "./access";
import { releaseOpenAssignments } from "./pickups";
import { SAFETY_VERSION } from "./safety";

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
