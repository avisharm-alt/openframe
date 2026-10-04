import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
import { draftSchema, structuralCheck } from "./validation";
import biochem from "../../content/western/biochem-2280a-150-questions.json";
import organic from "../../content/western/chem-2213a-150-questions.json";

const courseInfo = {
  "BIOCHEM 2280A": { slug: "biochem-2280a", title: "Biochemistry and Molecular Biology", subject: "Biochemistry" },
  "CHEM 2213A": { slug: "chem-2213a", title: "Organic Chemistry for Life Sciences", subject: "Chemistry" },
} as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const questionSchema = z.strictObject({
  questionKey: text(100),
  courseCode: z.enum(["BIOCHEM 2280A", "CHEM 2213A"]),
  section: z.literal("lecture"),
  unit: text(200),
  topic: text(200),
  stem: text(3000),
  learningObjective: text(300),
  difficulty: z.enum(["introductory", "intermediate", "challenging"]),
  options: z.array(z.strictObject({ key: text(10), text: text(500), explanation: text(2000) })).length(4),
  correctOptionKey: text(10),
  aiProvenance: z.enum(["ai_generated", "ai_assisted"]),
  aiTool: text(100),
  aiGeneratedOn: z.iso.date(),
  reviewStatus: z.literal("unreviewed"),
  checkDescription: text(1000),
  referenceText: text(500),
  sourceEvidence: z.array(z.strictObject({ file: text(500), location: text(500), supports: text(2000) })).optional(),
});

export function validateQuestionBank(raw: unknown) {
  const rows = z.array(questionSchema).min(1).parse(raw);
  const keys = new Set<string>();
  const stems = new Set<string>();
  for (const q of rows) {
    if (keys.has(q.questionKey)) throw new Error(`Duplicate question key: ${q.questionKey}`);
    keys.add(q.questionKey);
    const stemKey = `${q.courseCode}:${q.stem.toLowerCase().replace(/\s+/g, " ")}`;
    if (stems.has(stemKey)) throw new Error(`Duplicate question stem: ${q.questionKey}`);
    stems.add(stemKey);
    if (new Set(q.options.map((o) => o.key)).size !== 4) throw new Error(`Duplicate option keys: ${q.questionKey}`);
    const options = q.options.map((o) => ({ id: randomUUID(), text: o.text, explanation: o.explanation }));
    const correctIndex = q.options.findIndex((o) => o.key === q.correctOptionKey);
    const draft = draftSchema.parse({
      courseId: randomUUID(), topicId: randomUUID(), stem: q.stem, learningObjective: q.learningObjective,
      options, correctOptionId: options[correctIndex]?.id, difficulty: q.difficulty,
      aiProvenance: q.aiProvenance, aiTool: q.aiTool, aiGeneratedOn: q.aiGeneratedOn,
      checkDescription: q.checkDescription, referenceText: q.referenceText,
    });
    const { errors } = structuralCheck(draft);
    if (errors.length) throw new Error(`${q.questionKey}: ${errors.map((e) => e.message).join("; ")}`);
  }
  return rows;
}

export function importQuestionBank(db: DB, raw: unknown, ownerReviewNote = "") {
  const rows = validateQuestionBank(raw);
  const result = { added: 0, existing: 0, evidenceUpdated: 0 };
  db.transaction(() => {
    const western = db.prepare("SELECT id FROM university WHERE slug = 'western' AND enabled = 1").get() as { id: string } | undefined;
    if (!western) throw new Error("Western University must be enabled before import.");
    for (const q of rows) {
      const { sourceEvidence, ...content } = q;
      const hash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
      const imported = db.prepare("SELECT question_id, content_hash FROM question_bank_import WHERE question_key = ?").get(q.questionKey) as { question_id: string; content_hash: string } | undefined;
      if (imported) {
        if (imported.content_hash !== hash) throw new Error(`${q.questionKey}: imported content differs; use a reviewed revision to edit it.`);
        if (sourceEvidence?.length) {
          db.prepare("UPDATE question_bank_import SET source_evidence = ? WHERE question_key = ?").run(JSON.stringify(sourceEvidence), q.questionKey);
          result.evidenceUpdated++;
        }
        result.existing++;
        continue;
      }
      const t = new Date().toISOString();
      const info = courseInfo[q.courseCode];
      let course = db.prepare("SELECT id, university_id FROM course WHERE slug = ?").get(info.slug) as { id: string; university_id: string } | undefined;
      if (course && course.university_id !== western.id) throw new Error(`Course slug belongs to a different university: ${info.slug}`);
      if (!course) {
        course = { id: randomUUID(), university_id: western.id };
        db.prepare("INSERT INTO course (id, university_id, slug, code, title, subject, description, status, is_demo, created_at) VALUES (?,?,?,?,?,?,?,'active',0,?)").run(
          course.id, western.id, info.slug, q.courseCode, info.title, info.subject,
          "Original, AI-generated lecture practice questions supplied to OpenFrame by the project owner.", t,
        );
      }
      let unit = db.prepare("SELECT id FROM unit WHERE course_id = ? AND title = ?").get(course.id, q.unit) as { id: string } | undefined;
      if (!unit) {
        unit = { id: randomUUID() };
        db.prepare("INSERT INTO unit (id, course_id, title, position) VALUES (?,?,?,(SELECT COUNT(*) FROM unit WHERE course_id = ?))").run(unit.id, course.id, q.unit, course.id);
      }
      let topic = db.prepare("SELECT id FROM topic WHERE unit_id = ? AND title = ?").get(unit.id, q.topic) as { id: string } | undefined;
      if (!topic) {
        topic = { id: randomUUID() };
        db.prepare("INSERT INTO topic (id, unit_id, course_id, title, position) VALUES (?,?,?,?,(SELECT COUNT(*) FROM topic WHERE unit_id = ?))").run(topic.id, unit.id, course.id, q.topic, unit.id);
      }
      const questionId = randomUUID();
      const revisionId = randomUUID();
      const optionIds = q.options.map(() => randomUUID());
      db.prepare("INSERT INTO question (id, course_id, topic_id, state, live_revision_id, is_demo, created_at, updated_at) VALUES (?,?,?,'published',?,0,?,?)").run(questionId, course.id, topic.id, revisionId, t, t);
      db.prepare(`INSERT INTO question_revision (id, question_id, number, state, topic_id, stem, learning_objective, difficulty,
        context_tag, ai_provenance, ai_tool, ai_generated_on, check_description, reference_text, correct_option_id, review_status, created_at)
        VALUES (?,?,1,'approved',?,?,?,?,?,?,?,?,?,?,?,'unreviewed',?)`).run(
        revisionId, questionId, topic.id, q.stem, q.learningObjective, q.difficulty, q.section,
        q.aiProvenance, q.aiTool, q.aiGeneratedOn, q.checkDescription.replace(/\s*Human review is pending\.?/gi, "").trim(), q.referenceText,
        optionIds[q.options.findIndex((o) => o.key === q.correctOptionKey)], t,
      );
      q.options.forEach((o, i) => db.prepare("INSERT INTO question_option (id, revision_id, position, text, explanation) VALUES (?,?,?,?,?)").run(optionIds[i], revisionId, i, o.text, o.explanation));
      db.prepare("INSERT INTO question_bank_import (question_key, question_id, content_hash, source_evidence, owner_review_note, imported_at) VALUES (?,?,?,?,?,?)").run(
        q.questionKey, questionId, hash, JSON.stringify(sourceEvidence ?? []), ownerReviewNote, t,
      );
      result.added++;
    }
  }).immediate();
  return result;
}

export function importBundledQuestionBank(db: DB) {
  const raw = [...biochem, ...organic];
  for (const code of Object.keys(courseInfo)) {
    if (raw.filter((q) => q.courseCode === code).length !== 150) throw new Error(`Expected 150 bundled questions for ${code}.`);
  }
  return importQuestionBank(db, raw, "The project owner stated they reviewed the supplied questions before requesting publication. This is an owner review statement, not an independent student review.");
}
