import { getDb } from "../db";
import { notFound } from "../errors";

/** SQL fragment: a question is publicly deliverable only if published with a live revision. */
export const PUBLISHED = "q.state = 'published' AND q.live_revision_id IS NOT NULL";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export type CourseSummary = {
  id: string;
  slug: string;
  code: string;
  title: string;
  subject: string;
  description: string;
  isDemo: boolean;
  universityName: string;
  universitySlug: string;
  reviewedCount: number;
  unreviewedCount: number;
  topicMatches: string[];
};

export type UniversitySummary = { slug: string; name: string; courseCount: number };

export function listUniversities(): UniversitySummary[] {
  return getDb().prepare(
    `SELECT u.slug, u.name, COUNT(c.id) AS courseCount
     FROM university u LEFT JOIN course c ON c.university_id = u.id AND c.status = 'active'
     WHERE u.enabled = 1
     GROUP BY u.id
     ORDER BY CASE u.slug WHEN 'western' THEN 0 WHEN 'uoft' THEN 1 ELSE 2 END, u.name`,
  ).all() as UniversitySummary[];
}

export function getUniversity(slug: string): UniversitySummary {
  const university = listUniversities().find((u) => u.slug === slug);
  if (!university) throw notFound("University not found");
  return university;
}

export function listCourses(q?: string, universitySlug?: string): CourseSummary[] {
  const db = getDb();
  const term = (q ?? "").trim().slice(0, 100);
  const like = `%${likeEscape(term.toLowerCase())}%`;
  const rows = db
    .prepare(
      `SELECT c.id, c.slug, c.code, c.title, c.subject, c.description, c.is_demo AS isDemo,
        u.name AS universityName, u.slug AS universitySlug,
        (SELECT COUNT(*) FROM question q JOIN question_revision r ON r.id = q.live_revision_id
           WHERE q.course_id = c.id AND ${PUBLISHED} AND r.review_status = 'student_reviewed') AS reviewedCount,
        (SELECT COUNT(*) FROM question q JOIN question_revision r ON r.id = q.live_revision_id
           WHERE q.course_id = c.id AND ${PUBLISHED} AND r.review_status = 'unreviewed') AS unreviewedCount
       FROM course c JOIN university u ON u.id = c.university_id
       WHERE c.status = 'active' AND u.enabled = 1
         AND (@universitySlug = '' OR u.slug = @universitySlug)
         AND (@term = '' OR lower(c.code) LIKE @like ESCAPE '\\' OR lower(c.title) LIKE @like ESCAPE '\\'
              OR lower(c.subject) LIKE @like ESCAPE '\\'
              OR EXISTS (SELECT 1 FROM topic t WHERE t.course_id = c.id AND lower(t.title) LIKE @like ESCAPE '\\'))
       ORDER BY c.code`,
    )
    .all({ term, like, universitySlug: universitySlug ?? "" }) as Omit<CourseSummary, "topicMatches">[];
  return rows.map((r) => ({
    ...r,
    isDemo: !!r.isDemo,
    topicMatches: term
      ? (
          db
            .prepare("SELECT title FROM topic WHERE course_id = ? AND lower(title) LIKE ? ESCAPE '\\' ORDER BY position")
            .all(r.id, like) as { title: string }[]
        ).map((t) => t.title)
      : [],
  }));
}

export type TopicInfo = { id: string; title: string; reviewedCount: number; unreviewedCount: number };
export type CourseDetail = CourseSummary & { units: { id: string; title: string; topics: TopicInfo[] }[]; contexts: { label: string; academicYear: string | null }[] };

export function getCourse(slug: string): CourseDetail {
  const db = getDb();
  const course = listCourses().find((c) => c.slug === slug);
  if (!course) throw notFound("Course not found");
  const units = db.prepare("SELECT id, title FROM unit WHERE course_id = ? ORDER BY position").all(course.id) as { id: string; title: string }[];
  const topicStmt = db.prepare(
    `SELECT t.id, t.title,
       (SELECT COUNT(*) FROM question q JOIN question_revision r ON r.id = q.live_revision_id
          WHERE q.topic_id = t.id AND ${PUBLISHED} AND r.review_status = 'student_reviewed') AS reviewedCount,
       (SELECT COUNT(*) FROM question q JOIN question_revision r ON r.id = q.live_revision_id
          WHERE q.topic_id = t.id AND ${PUBLISHED} AND r.review_status = 'unreviewed') AS unreviewedCount
     FROM topic t WHERE t.unit_id = ? ORDER BY t.position`,
  );
  const contexts = db
    .prepare("SELECT label, academic_year AS academicYear FROM course_context WHERE course_id = ?")
    .all(course.id) as { label: string; academicYear: string | null }[];
  return { ...course, contexts, units: units.map((u) => ({ ...u, topics: topicStmt.all(u.id) as TopicInfo[] })) };
}

/** Course/topic pairs for the contribution form (active courses of enabled universities). */
export function contributionTargets() {
  const db = getDb();
  const courses = db
    .prepare(
      `SELECT c.id, c.code, c.title, c.is_demo AS isDemo FROM course c JOIN university u ON u.id = c.university_id
       WHERE c.status='active' AND u.enabled=1 ORDER BY c.code`,
    )
    .all() as { id: string; code: string; title: string; isDemo: number }[];
  const topics = db
    .prepare(
      `SELECT t.id, t.course_id AS courseId, t.title, un.title AS unit FROM topic t JOIN unit un ON un.id = t.unit_id
       ORDER BY un.position, t.position`,
    )
    .all() as { id: string; courseId: string; title: string; unit: string }[];
  return courses.map((c) => ({ ...c, isDemo: !!c.isDemo, topics: topics.filter((t) => t.courseId === c.id) }));
}

/** Public question view: never includes the answer key, explanations or private review data. */
export type PublicQuestion = {
  id: string;
  stem: string;
  options: { id: string; text: string }[];
  difficulty: string | null;
  aiProvenance: string | null;
  aiTool: string | null;
  reviewStatus: string;
  reviewedAt: string | null;
  isDemo: boolean;
  courseId: string;
  courseCode: string;
  topic: string;
  learningObjective: string;
};

export function getPublicQuestion(id: string): PublicQuestion {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT q.id, q.is_demo AS isDemo, q.course_id AS courseId, c.code AS courseCode, t.title AS topic,
         r.id AS revisionId, r.stem, r.difficulty, r.ai_provenance AS aiProvenance, r.ai_tool AS aiTool,
         r.review_status AS reviewStatus, r.reviewed_at AS reviewedAt, r.learning_objective AS learningObjective
       FROM question q JOIN question_revision r ON r.id = q.live_revision_id
       JOIN course c ON c.id = q.course_id JOIN topic t ON t.id = q.topic_id
       WHERE q.id = ? AND ${PUBLISHED}`,
    )
    .get(id) as (Omit<PublicQuestion, "options" | "isDemo"> & { revisionId: string; isDemo: number }) | undefined;
  if (!row) throw notFound("Question not found");
  const options = db
    .prepare("SELECT id, text FROM question_option WHERE revision_id = ? ORDER BY position")
    .all(row.revisionId) as { id: string; text: string }[];
  const { revisionId: _r, isDemo, ...rest } = row;
  void _r;
  return { ...rest, isDemo: !!isDemo, options };
}
