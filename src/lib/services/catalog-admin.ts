import { getDb, now, uid, type DB } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { isMaintainer, type Actor } from "../types";
import {
  courseCreateSchema,
  courseRequestStatusSchema,
  courseUpdateSchema,
  outlineSchema,
  topicCreateSchema,
  topicUpdateSchema,
  unitCreateSchema,
  unitUpdateSchema,
} from "../validation";
import { listUniversities } from "./catalog";
import { logEvent } from "./events";

/**
 * Course catalog administration (maintainers only): courses, units and topics.
 * Every mutation is written to the moderation audit log. Titles and codes are public catalog data, so they
 * may appear in audit details; nothing here records personal data.
 */

function requireMaintainer(actor: Actor) {
  if (!isMaintainer(actor)) throw forbidden("Maintainer access required.");
}

export const OUTLINE_LIMITS = { units: 40, topicsPerUnit: 60, unitTitle: 120, topicTitle: 160 } as const;

export type Outline = { title: string; topics: string[] }[];

/**
 * Parses a plain-text outline: every non-blank line that does not start with "-", "*" or "•" is a unit heading
 * (optional leading "#"); lines that do start with one of those are topics of the unit above them.
 * Throws a 422 naming the offending line.
 */
export function parseOutline(text: string): Outline {
  const units: Outline = [];
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const bullet = /^[-*•]\s*(.*)$/.exec(trimmed);
    if (bullet) {
      const title = clean(bullet[1]);
      const unit = units[units.length - 1];
      if (!unit) throw invalid(`Line ${n}: a topic needs a unit heading above it.`);
      if (!title) throw invalid(`Line ${n}: this topic has no title.`);
      if (title.length > OUTLINE_LIMITS.topicTitle) throw invalid(`Line ${n}: topic titles can have at most ${OUTLINE_LIMITS.topicTitle} characters.`);
      if (unit.topics.some((t) => t.toLowerCase() === title.toLowerCase())) throw invalid(`Line ${n}: “${title}” is listed twice under “${unit.title}”.`);
      if (unit.topics.length >= OUTLINE_LIMITS.topicsPerUnit) throw invalid(`Line ${n}: a unit can have at most ${OUTLINE_LIMITS.topicsPerUnit} topics.`);
      unit.topics.push(title);
    } else {
      const title = clean(trimmed.replace(/^#{1,6}\s*/, ""));
      if (!title) throw invalid(`Line ${n}: this unit has no title.`);
      if (title.length > OUTLINE_LIMITS.unitTitle) throw invalid(`Line ${n}: unit titles can have at most ${OUTLINE_LIMITS.unitTitle} characters.`);
      if (units.some((u) => u.title.toLowerCase() === title.toLowerCase())) throw invalid(`Line ${n}: the unit “${title}” is listed twice.`);
      if (units.length >= OUTLINE_LIMITS.units) throw invalid(`Line ${n}: an outline can have at most ${OUTLINE_LIMITS.units} units.`);
      units.push({ title, topics: [] });
    }
  });
  if (!units.length) throw invalid("The outline is empty. Add a unit heading, then its topics starting with “-”.");
  return units;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** Course slugs are public URLs, so they are generated once and never change. */
function uniqueSlug(db: DB, universitySlug: string, code: string): string {
  const base = slugify(code) || "course";
  const taken = (s: string) => !!db.prepare("SELECT 1 FROM course WHERE slug = ?").get(s);
  if (!taken(base)) return base;
  const prefixed = slugify(`${universitySlug}-${base}`);
  if (!taken(prefixed)) return prefixed;
  for (let n = 2; ; n++) {
    const s = `${prefixed}-${n}`;
    if (!taken(s)) return s;
  }
}

function assertCodeFree(db: DB, universityId: string, universityName: string, code: string, exceptCourseId?: string) {
  const dup = db
    .prepare("SELECT status FROM course WHERE university_id = ? AND lower(code) = lower(?) AND id != ?")
    .get(universityId, code, exceptCourseId ?? "") as { status: string } | undefined;
  if (dup) {
    throw conflict("duplicate_course", `${universityName} already has a course with the code ${code}${dup.status === "archived" ? " (archived; restore it instead)" : ""}.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

export type AdminCourseRow = {
  id: string;
  slug: string;
  code: string;
  title: string;
  subject: string;
  status: "active" | "archived";
  isDemo: boolean;
  universityName: string;
  universitySlug: string;
  unitCount: number;
  topicCount: number;
  publishedCount: number;
  questionCount: number;
};

/** All courses, including archived ones, for the maintainer course list. */
export function listAdminCourses(actor: Actor): AdminCourseRow[] {
  requireMaintainer(actor);
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.slug, c.code, c.title, c.subject, c.status, c.is_demo AS isDemo,
         u.name AS universityName, u.slug AS universitySlug,
         (SELECT COUNT(*) FROM unit WHERE course_id = c.id) AS unitCount,
         (SELECT COUNT(*) FROM topic WHERE course_id = c.id) AS topicCount,
         (SELECT COUNT(*) FROM question WHERE course_id = c.id AND state = 'published') AS publishedCount,
         (SELECT COUNT(*) FROM question WHERE course_id = c.id) AS questionCount
       FROM course c JOIN university u ON u.id = c.university_id
       ORDER BY CASE u.slug WHEN 'western' THEN 0 WHEN 'uoft' THEN 1 ELSE 2 END, u.name, c.status, c.code`,
    )
    .all() as (Omit<AdminCourseRow, "isDemo"> & { isDemo: number })[];
  return rows.map((r) => ({ ...r, isDemo: !!r.isDemo }));
}

export type AdminTopic = { id: string; title: string; questionCount: number };
export type AdminUnit = { id: string; title: string; topics: AdminTopic[] };
export type AdminCourse = {
  id: string;
  slug: string;
  code: string;
  title: string;
  subject: string;
  description: string;
  status: "active" | "archived";
  isDemo: boolean;
  universityName: string;
  universitySlug: string;
  questionCount: number;
  publishedCount: number;
  units: AdminUnit[];
};

export function getAdminCourse(actor: Actor, id: string): AdminCourse {
  requireMaintainer(actor);
  const db = getDb();
  const c = db
    .prepare(
      `SELECT c.id, c.slug, c.code, c.title, c.subject, c.description, c.status, c.is_demo AS isDemo,
         u.name AS universityName, u.slug AS universitySlug,
         (SELECT COUNT(*) FROM question WHERE course_id = c.id) AS questionCount,
         (SELECT COUNT(*) FROM question WHERE course_id = c.id AND state = 'published') AS publishedCount
       FROM course c JOIN university u ON u.id = c.university_id WHERE c.id = ?`,
    )
    .get(id) as (Omit<AdminCourse, "units" | "isDemo"> & { isDemo: number }) | undefined;
  if (!c) throw notFound("Course not found");
  const units = db.prepare("SELECT id, title FROM unit WHERE course_id = ? ORDER BY position, rowid").all(id) as { id: string; title: string }[];
  // A topic counts as "in use" if a question or any of its revisions points at it.
  const topics = db
    .prepare(
      `SELECT t.id, t.unit_id AS unitId, t.title,
         (SELECT COUNT(*) FROM (SELECT id FROM question WHERE topic_id = t.id UNION SELECT question_id FROM question_revision WHERE topic_id = t.id)) AS questionCount
       FROM topic t WHERE t.course_id = ? ORDER BY t.position, t.rowid`,
    )
    .all(id) as { id: string; unitId: string; title: string; questionCount: number }[];
  return {
    ...c,
    isDemo: !!c.isDemo,
    units: units.map((u) => ({
      ...u,
      topics: topics.filter((t) => t.unitId === u.id).map((t) => ({ id: t.id, title: t.title, questionCount: t.questionCount })),
    })),
  };
}

/** A course request, for pre-filling the "new course" form. */
export function getCourseRequest(actor: Actor, id: string) {
  requireMaintainer(actor);
  const r = getDb()
    .prepare("SELECT id, university_slug AS universitySlug, code, title, note, status FROM course_request WHERE id = ?")
    .get(id) as { id: string; universitySlug: string | null; code: string; title: string; note: string; status: string } | undefined;
  if (!r) throw notFound("Course request not found");
  return r;
}

export function adminUniversities(actor: Actor) {
  requireMaintainer(actor);
  return listUniversities().map(({ slug, name }) => ({ slug, name }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------------------------------------------------

function nextPosition(db: DB, table: "unit" | "topic", scopeCol: "course_id" | "unit_id", scopeId: string): number {
  const r = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ${table} WHERE ${scopeCol} = ?`).get(scopeId) as { n: number };
  return r.n;
}

const unitTitleTaken = (db: DB, courseId: string, title: string, exceptId = "") =>
  !!db.prepare("SELECT 1 FROM unit WHERE course_id = ? AND lower(title) = lower(?) AND id != ?").get(courseId, title, exceptId);
const topicTitleTaken = (db: DB, unitId: string, title: string, exceptId = "") =>
  !!db.prepare("SELECT 1 FROM topic WHERE unit_id = ? AND lower(title) = lower(?) AND id != ?").get(unitId, title, exceptId);

/** Appends units and topics to a course. Refuses unit titles that already exist so nothing is silently merged. */
function insertOutline(db: DB, courseId: string, outline: Outline) {
  let position = nextPosition(db, "unit", "course_id", courseId);
  let topics = 0;
  for (const u of outline) {
    if (unitTitleTaken(db, courseId, u.title)) throw conflict("duplicate_unit", `A unit called “${u.title}” already exists in this course.`);
    const unitId = uid();
    db.prepare("INSERT INTO unit (id, course_id, title, position) VALUES (?,?,?,?)").run(unitId, courseId, u.title, position++);
    u.topics.forEach((title, i) => {
      db.prepare("INSERT INTO topic (id, unit_id, course_id, title, position) VALUES (?,?,?,?,?)").run(uid(), unitId, courseId, title, i);
      topics++;
    });
  }
  return { units: outline.length, topics };
}

export function createCourse(actor: Actor, raw: unknown) {
  requireMaintainer(actor);
  const input = courseCreateSchema.parse(raw);
  const outline = input.outline ? parseOutline(input.outline) : [];
  const db = getDb();
  return db.transaction(() => {
    const uni = db.prepare("SELECT id, slug, name FROM university WHERE slug = ? AND enabled = 1").get(input.universitySlug) as
      | { id: string; slug: string; name: string }
      | undefined;
    if (!uni) throw invalid("Unknown university.");
    assertCodeFree(db, uni.id, uni.name, input.code);
    let requestId: string | null = null;
    if (input.requestId) {
      const req = db.prepare("SELECT id, status FROM course_request WHERE id = ?").get(input.requestId) as { id: string; status: string } | undefined;
      if (!req) throw notFound("Course request not found");
      if (req.status !== "open") throw conflict("request_handled", "That course request has already been handled.");
      requestId = req.id;
    }
    const id = uid();
    const slug = uniqueSlug(db, uni.slug, input.code);
    db.prepare(
      "INSERT INTO course (id, university_id, slug, code, title, subject, description, status, is_demo, created_at) VALUES (?,?,?,?,?,?,?,'active',0,?)",
    ).run(id, uni.id, slug, input.code, input.title, input.subject, input.description, now());
    const counts = outline.length ? insertOutline(db, id, outline) : { units: 0, topics: 0 };
    if (requestId) db.prepare("UPDATE course_request SET status = 'added', course_id = ?, handled_at = ? WHERE id = ?").run(id, now(), requestId);
    logEvent(actor.id, "course_created", { detail: { courseId: id, code: input.code, university: uni.slug, ...counts, fromRequest: !!requestId } });
    return { id, slug, ...counts };
  })();
}

export function updateCourse(actor: Actor, id: string, raw: unknown) {
  requireMaintainer(actor);
  const input = courseUpdateSchema.parse(raw);
  const db = getDb();
  const c = db
    .prepare(
      `SELECT c.code, c.title, c.subject, c.description, c.status, c.university_id AS universityId, u.name AS universityName
       FROM course c JOIN university u ON u.id = c.university_id WHERE c.id = ?`,
    )
    .get(id) as { code: string; title: string; subject: string; description: string; status: "active" | "archived"; universityId: string; universityName: string } | undefined;
  if (!c) throw notFound("Course not found");
  if (input.code !== undefined) assertCodeFree(db, c.universityId, c.universityName, input.code, id);
  const next = { ...c, ...input };
  const changed = (["code", "title", "subject", "description", "status"] as const).filter((k) => next[k] !== c[k]);
  if (!changed.length) return { id, changed };
  db.transaction(() => {
    db.prepare("UPDATE course SET code = ?, title = ?, subject = ?, description = ?, status = ? WHERE id = ?").run(
      next.code, next.title, next.subject, next.description, next.status, id,
    );
    const fields = changed.filter((k) => k !== "status");
    if (fields.length) logEvent(actor.id, "course_updated", { detail: { courseId: id, code: next.code, fields } });
    if (changed.includes("status")) logEvent(actor.id, next.status === "archived" ? "course_archived" : "course_restored", { detail: { courseId: id, code: next.code } });
  })();
  return { id, changed };
}

/** Only courses that never had a question can be deleted; everything else is archived (kept for audit and links). */
export function deleteCourse(actor: Actor, id: string) {
  requireMaintainer(actor);
  const db = getDb();
  const c = db.prepare("SELECT c.code, u.slug AS university FROM course c JOIN university u ON u.id = c.university_id WHERE c.id = ?").get(id) as
    | { code: string; university: string }
    | undefined;
  if (!c) throw notFound("Course not found");
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM question WHERE course_id = ?").get(id) as { n: number };
  if (n > 0) throw conflict("course_in_use", `This course has ${n} question${n === 1 ? "" : "s"}, so it cannot be deleted. Archive it instead.`);
  db.transaction(() => {
    db.prepare("DELETE FROM course WHERE id = ?").run(id);
    logEvent(actor.id, "course_deleted", { detail: { courseId: id, code: c.code, university: c.university } });
  })();
  return { deleted: true };
}

export function addOutline(actor: Actor, courseId: string, raw: unknown) {
  requireMaintainer(actor);
  const { text } = outlineSchema.parse(raw);
  const outline = parseOutline(text);
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM course WHERE id = ?").get(courseId)) throw notFound("Course not found");
  return db.transaction(() => {
    const counts = insertOutline(db, courseId, outline);
    logEvent(actor.id, "outline_added", { detail: { courseId, ...counts } });
    return counts;
  })();
}

// ---------------------------------------------------------------------------------------------------------------------
// Units and topics
// ---------------------------------------------------------------------------------------------------------------------

/** Moves one item a step up or down within its siblings, renumbering positions 0..n-1 (no ties). Returns false at the ends. */
function move(db: DB, table: "unit" | "topic", scopeCol: "course_id" | "unit_id", scopeId: string, id: string, dir: "up" | "down"): boolean {
  const ids = (db.prepare(`SELECT id FROM ${table} WHERE ${scopeCol} = ? ORDER BY position, rowid`).all(scopeId) as { id: string }[]).map((r) => r.id);
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  renumber(db, table, ids);
  return true;
}

function renumber(db: DB, table: "unit" | "topic", ids: string[]) {
  const upd = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  ids.forEach((id, position) => upd.run(position, id));
}

export function createUnit(actor: Actor, courseId: string, raw: unknown) {
  requireMaintainer(actor);
  const { title } = unitCreateSchema.parse(raw);
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM course WHERE id = ?").get(courseId)) throw notFound("Course not found");
  if (unitTitleTaken(db, courseId, title)) throw conflict("duplicate_unit", `This course already has a unit called “${title}”.`);
  const id = uid();
  db.transaction(() => {
    db.prepare("INSERT INTO unit (id, course_id, title, position) VALUES (?,?,?,?)").run(id, courseId, title, nextPosition(db, "unit", "course_id", courseId));
    logEvent(actor.id, "unit_created", { detail: { courseId, title } });
  })();
  return { id };
}

function getUnit(db: DB, id: string) {
  const u = db.prepare("SELECT id, course_id AS courseId, title FROM unit WHERE id = ?").get(id) as { id: string; courseId: string; title: string } | undefined;
  if (!u) throw notFound("Unit not found");
  return u;
}

export function updateUnit(actor: Actor, id: string, raw: unknown) {
  requireMaintainer(actor);
  const input = unitUpdateSchema.parse(raw);
  const db = getDb();
  const u = getUnit(db, id);
  if (input.title !== undefined) {
    if (unitTitleTaken(db, u.courseId, input.title, id)) throw conflict("duplicate_unit", `This course already has a unit called “${input.title}”.`);
    if (input.title !== u.title) {
      db.transaction(() => {
        db.prepare("UPDATE unit SET title = ? WHERE id = ?").run(input.title, id);
        logEvent(actor.id, "unit_renamed", { detail: { courseId: u.courseId, from: u.title, to: input.title } });
      })();
    }
    return { id };
  }
  const moved = db.transaction(() => {
    const ok = move(db, "unit", "course_id", u.courseId, id, input.move!);
    if (ok) logEvent(actor.id, "unit_moved", { detail: { courseId: u.courseId, title: u.title, direction: input.move } });
    return ok;
  })();
  return { id, moved };
}

export function deleteUnit(actor: Actor, id: string) {
  requireMaintainer(actor);
  const db = getDb();
  const u = getUnit(db, id);
  const used = db
    .prepare(
      `SELECT COUNT(*) AS n FROM topic t WHERE t.unit_id = ?
         AND (EXISTS (SELECT 1 FROM question WHERE topic_id = t.id) OR EXISTS (SELECT 1 FROM question_revision WHERE topic_id = t.id))`,
    )
    .get(id) as { n: number };
  if (used.n > 0) {
    throw conflict("unit_in_use", `${used.n} topic${used.n === 1 ? " in this unit has" : "s in this unit have"} questions, so the unit cannot be deleted. Rename it instead.`);
  }
  db.transaction(() => {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM topic WHERE unit_id = ?").get(id) as { n: number };
    db.prepare("DELETE FROM unit WHERE id = ?").run(id);
    renumber(db, "unit", (db.prepare("SELECT id FROM unit WHERE course_id = ? ORDER BY position, rowid").all(u.courseId) as { id: string }[]).map((r) => r.id));
    logEvent(actor.id, "unit_deleted", { detail: { courseId: u.courseId, title: u.title, topics: n } });
  })();
  return { deleted: true };
}

export function createTopic(actor: Actor, unitId: string, raw: unknown) {
  requireMaintainer(actor);
  const { title } = topicCreateSchema.parse(raw);
  const db = getDb();
  const u = getUnit(db, unitId);
  if (topicTitleTaken(db, unitId, title)) throw conflict("duplicate_topic", `“${u.title}” already has a topic called “${title}”.`);
  const id = uid();
  db.transaction(() => {
    db.prepare("INSERT INTO topic (id, unit_id, course_id, title, position) VALUES (?,?,?,?,?)").run(id, unitId, u.courseId, title, nextPosition(db, "topic", "unit_id", unitId));
    logEvent(actor.id, "topic_created", { detail: { courseId: u.courseId, unit: u.title, title } });
  })();
  return { id };
}

function getTopic(db: DB, id: string) {
  const t = db
    .prepare("SELECT t.id, t.unit_id AS unitId, t.course_id AS courseId, t.title, u.title AS unitTitle FROM topic t JOIN unit u ON u.id = t.unit_id WHERE t.id = ?")
    .get(id) as { id: string; unitId: string; courseId: string; title: string; unitTitle: string } | undefined;
  if (!t) throw notFound("Topic not found");
  return t;
}

export function updateTopic(actor: Actor, id: string, raw: unknown) {
  requireMaintainer(actor);
  const input = topicUpdateSchema.parse(raw);
  const db = getDb();
  const t = getTopic(db, id);
  if (input.title !== undefined) {
    if (topicTitleTaken(db, t.unitId, input.title, id)) throw conflict("duplicate_topic", `“${t.unitTitle}” already has a topic called “${input.title}”.`);
    if (input.title !== t.title) {
      db.transaction(() => {
        db.prepare("UPDATE topic SET title = ? WHERE id = ?").run(input.title, id);
        logEvent(actor.id, "topic_renamed", { detail: { courseId: t.courseId, from: t.title, to: input.title } });
      })();
    }
    return { id };
  }
  const moved = db.transaction(() => {
    const ok = move(db, "topic", "unit_id", t.unitId, id, input.move!);
    if (ok) logEvent(actor.id, "topic_moved", { detail: { courseId: t.courseId, unit: t.unitTitle, title: t.title, direction: input.move } });
    return ok;
  })();
  return { id, moved };
}

export function deleteTopic(actor: Actor, id: string) {
  requireMaintainer(actor);
  const db = getDb();
  const t = getTopic(db, id);
  const used = db
    .prepare("SELECT COUNT(*) AS n FROM (SELECT id FROM question WHERE topic_id = ? UNION SELECT question_id FROM question_revision WHERE topic_id = ?)")
    .get(id, id) as { n: number };
  if (used.n > 0) throw conflict("topic_in_use", `This topic is used by ${used.n} question${used.n === 1 ? "" : "s"}, so it cannot be deleted. Rename it instead.`);
  db.transaction(() => {
    db.prepare("DELETE FROM topic WHERE id = ?").run(id);
    renumber(db, "topic", (db.prepare("SELECT id FROM topic WHERE unit_id = ? ORDER BY position, rowid").all(t.unitId) as { id: string }[]).map((r) => r.id));
    logEvent(actor.id, "topic_deleted", { detail: { courseId: t.courseId, unit: t.unitTitle, title: t.title } });
  })();
  return { deleted: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Course requests
// ---------------------------------------------------------------------------------------------------------------------

/** Dismiss a request (no action will be taken) or reopen a dismissed one. Requests that became a course stay as they are. */
export function setCourseRequestStatus(actor: Actor, id: string, raw: unknown) {
  requireMaintainer(actor);
  const { status } = courseRequestStatusSchema.parse(raw);
  const db = getDb();
  const r = db.prepare("SELECT code, status FROM course_request WHERE id = ?").get(id) as { code: string; status: string } | undefined;
  if (!r) throw notFound("Course request not found");
  if (r.status === "added") throw conflict("request_handled", "This request was already turned into a course.");
  if (r.status === status) return { status };
  db.transaction(() => {
    db.prepare("UPDATE course_request SET status = ?, handled_at = ? WHERE id = ?").run(status, status === "open" ? null : now(), id);
    logEvent(actor.id, status === "dismissed" ? "course_request_dismissed" : "course_request_reopened", { detail: { requestId: id, code: r.code } });
  })();
  return { status };
}
