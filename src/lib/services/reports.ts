import { z } from "zod";
import { getDb, now, uid } from "../db";
import { notFound, invalid } from "../errors";
import { courseRequestSchema, reportSchema } from "../validation";
import type { Actor } from "../types";
import { logEvent } from "./events";

/**
 * Anyone may report. A report never changes publication state by itself: it enters a queue
 * (prohibited-content and removal requests are prioritised) for a human moderator to act on.
 */
export function createReport(actor: Actor | null, reporterHash: string, raw: z.infer<typeof reportSchema>) {
  const db = getDb();
  const input = reportSchema.parse(raw);
  let revisionId: string | null = null;
  if (input.questionId) {
    const q = db.prepare("SELECT live_revision_id AS live FROM question WHERE id = ?").get(input.questionId) as { live: string | null } | undefined;
    if (!q) throw notFound("Question not found");
    revisionId = q.live;
  }
  // De-duplicate repeat submissions of the same open report by the same reporter.
  const dup = db
    .prepare(
      `SELECT id FROM report WHERE state IN ('open','investigating') AND category = ? AND IFNULL(question_id,'') = IFNULL(?,'')
         AND ((reporter_id IS NOT NULL AND reporter_id = ?) OR (reporter_hash IS NOT NULL AND reporter_hash = ?))`,
    )
    .get(input.category, input.questionId ?? null, actor?.id ?? "", reporterHash) as { id: string } | undefined;
  if (dup) return { id: dup.id, duplicate: true };
  const priority = input.category === "prohibited" || input.category === "removal_request" ? 1 : 0;
  const id = uid();
  db.prepare(
    "INSERT INTO report (id, question_id, revision_id, reporter_id, reporter_hash, category, details, priority, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'open',?,?)",
  ).run(id, input.questionId ?? null, revisionId, actor?.id ?? null, reporterHash, input.category, input.details, priority, now(), now());
  logEvent(null, "report_created", { questionId: input.questionId, reportId: id, detail: { category: input.category } });
  return { id, duplicate: false };
}

export function createCourseRequest(actor: Actor | null, raw: z.infer<typeof courseRequestSchema>) {
  const input = courseRequestSchema.parse(raw);
  const id = uid();
  const db = getDb();
  if (input.universitySlug && !db.prepare("SELECT 1 FROM university WHERE slug = ? AND enabled = 1").get(input.universitySlug)) {
    throw invalid("Unknown university.");
  }
  db.prepare("INSERT INTO course_request (id, user_id, university_slug, code, title, note, created_at) VALUES (?,?,?,?,?,?,?)").run(
    id, actor?.id ?? null, input.universitySlug ?? null, input.code, input.title, input.note, now(),
  );
  return { id };
}
