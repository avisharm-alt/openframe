import type { DB } from "./db";
import { uid, now } from "./db";
import { SEED_COURSES } from "./seed-data";

/**
 * Inserts the demonstration courses and questions. Demo only:
 * every question is labelled demo (`is_demo = 1`), published but UNREVIEWED, and has no reviewer.
 * Never call this in production; scripts/seed-demo.ts refuses to.
 */
export function seedDemoContent(db: DB) {
  const t = now();
  const existing = db.prepare("SELECT id FROM university WHERE slug = 'western'").get() as { id: string } | undefined;
  const uniId = existing?.id ?? uid();
  if (!existing) {
    // Demo courses belong to Western; U of T starts without courses.
    db.prepare("INSERT INTO university (id, slug, name, enabled) VALUES (?,?,?,1)").run(uniId, "western", "Western University");
  }
  const out: { courseId: string; slug: string; topicIds: Record<string, string>; questionIds: string[] }[] = [];
  db.transaction(() => {
    for (const c of SEED_COURSES) {
      if (db.prepare("SELECT 1 FROM course WHERE slug = ?").get(c.slug)) continue;
      const courseId = uid();
      db.prepare("INSERT INTO course (id, university_id, slug, code, title, subject, description, status, is_demo, created_at) VALUES (?,?,?,?,?,?,?,'active',1,?)").run(
        courseId, uniId, c.slug, c.code, c.title, c.subject, c.description, t,
      );
      const topicIds: Record<string, string> = {};
      c.units.forEach((u, ui) => {
        const unitId = uid();
        db.prepare("INSERT INTO unit (id, course_id, title, position) VALUES (?,?,?,?)").run(unitId, courseId, u.title, ui);
        u.topics.forEach((tp, ti) => {
          const topicId = uid();
          topicIds[tp] = topicId;
          db.prepare("INSERT INTO topic (id, unit_id, course_id, title, position) VALUES (?,?,?,?,?)").run(topicId, unitId, courseId, tp, ti);
        });
      });
      const questionIds: string[] = [];
      for (const q of c.questions) {
        const qid = uid();
        const rid = uid();
        const optIds = q.options.map(() => uid());
        db.prepare("INSERT INTO question (id, course_id, topic_id, author_id, state, live_revision_id, is_demo, created_at, updated_at) VALUES (?,?,?,NULL,'published',?,1,?,?)").run(
          qid, courseId, topicIds[q.topic], rid, t, t,
        );
        db.prepare(
          `INSERT INTO question_revision (id, question_id, number, author_id, state, topic_id, stem, learning_objective, difficulty, ai_provenance,
             check_description, correct_option_id, review_status, created_at, submitted_at)
           VALUES (?,?,1,NULL,'approved',?,?,?,?, 'ai_generated', ?,?, 'unreviewed', ?,?)`,
        ).run(
          rid, qid, topicIds[q.topic], q.stem, q.objective, q.difficulty,
          "Demo seed question. The answer was derived when the demo set was written and has not been independently verified.",
          optIds[q.correct], t, t,
        );
        q.options.forEach(([text, explanation], i) => {
          db.prepare("INSERT INTO question_option (id, revision_id, position, text, explanation) VALUES (?,?,?,?,?)").run(optIds[i], rid, i, text, explanation);
        });
        questionIds.push(qid);
      }
      out.push({ courseId, slug: c.slug, topicIds, questionIds });
    }
  })();
  return out;
}
