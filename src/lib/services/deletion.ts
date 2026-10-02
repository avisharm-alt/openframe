import { getDb, now, type DB } from "../db";
import { forbidden, invalid, notFound } from "../errors";
import { isMaintainer, type Actor } from "../types";
import { logEvent } from "./events";

/** "removed": the row is gone. "erased": other students' practice history still points at it, so an empty anonymous shell stays. */
export type DeleteOutcome = { id: string; outcome: "removed" | "erased" };

type QRow = { id: string; author_id: string | null; state: string; deleted_at: string | null };

function load(db: DB, qid: string): QRow | undefined {
  return db.prepare("SELECT id, author_id, state, deleted_at FROM question WHERE id = ?").get(qid) as QRow | undefined;
}

/**
 * Permanently deletes a question's content. Practice sessions reference questions and revisions without a delete rule, so a
 * question that has been practised cannot simply be dropped without rewriting other students' history. In that case the text,
 * options, explanations, review notes, bookmarks and author link are erased and an empty shell remains (shown as unavailable and
 * excluded from scoring, exactly like a withdrawn question). Anything else is deleted outright.
 */
function erase(db: DB, qid: string): DeleteOutcome["outcome"] {
  return db.transaction(() => {
    const practised = db.prepare("SELECT 1 FROM session_question WHERE question_id = ? LIMIT 1").get(qid);
    if (!practised) {
      db.prepare("DELETE FROM question WHERE id = ?").run(qid); // cascades to revisions, options, reviews, bookmarks
      return "removed" as const;
    }
    const revs = "SELECT id FROM question_revision WHERE question_id = ?";
    db.prepare(`DELETE FROM question_option WHERE revision_id IN (${revs})`).run(qid);
    db.prepare(`DELETE FROM review WHERE revision_id IN (${revs})`).run(qid);
    db.prepare("DELETE FROM bookmark WHERE question_id = ?").run(qid);
    db.prepare(
      `UPDATE question_revision SET state='withdrawn', author_id=NULL, stem='', learning_objective='', difficulty=NULL, context_tag=NULL,
         ai_provenance=NULL, ai_tool=NULL, ai_generated_on=NULL, check_description='', reference_text=NULL, reference_url=NULL,
         correct_option_id=NULL, attested_at=NULL, attestation_text=NULL, reviewed_by=NULL, flags='[]' WHERE question_id = ?`,
    ).run(qid);
    const t = now();
    db.prepare(
      `UPDATE question SET state='withdrawn', author_id=NULL, public_attribution=0, live_revision_id=NULL,
         withdrawn_reason='Deleted', withdrawn_at=?, deleted_at=?, updated_at=? WHERE id = ?`,
    ).run(t, t, t, qid);
    return "erased" as const;
  })();
}

/** Anyone can permanently delete a question they authored, in any state. Other people's questions are a 404 so ids cannot be probed. */
export function deleteOwnQuestion(actor: Actor, qid: string): DeleteOutcome {
  const db = getDb();
  const q = load(db, qid);
  if (!q || q.deleted_at || q.author_id !== actor.id) throw notFound("Contribution not found");
  const outcome = erase(db, qid);
  logEvent(actor.id, "deleted_by_author", { questionId: qid, detail: { outcome, state: q.state } });
  return { id: qid, outcome };
}

/** Maintainers can permanently delete any question. A short reason is required and is kept in the audit log. */
export function deleteAnyQuestion(actor: Actor, qid: string, reason: string): DeleteOutcome {
  if (!isMaintainer(actor)) throw forbidden("Maintainer access required.");
  const why = reason.trim();
  if (why.length < 5) throw invalid("Give a short reason for the deletion.");
  const db = getDb();
  const q = load(db, qid);
  if (!q || q.deleted_at) throw notFound("Question not found");
  const outcome = erase(db, qid);
  logEvent(actor.id, "deleted_by_maintainer", { questionId: qid, detail: { outcome, state: q.state, reason: why.slice(0, 200) } });
  return { id: qid, outcome };
}

export type QuestionRow = {
  id: string;
  state: string;
  courseCode: string;
  topic: string;
  stem: string | null;
  authorName: string | null;
  reviewStatus: string | null;
  updatedAt: string;
};

/**
 * Maintainers only: every question that has not been deleted, newest first (capped). Drafts are private to their authors, so their
 * text is not shown here; a maintainer can still delete one by id.
 */
export function listAllQuestions(actor: Actor, limit = 300): QuestionRow[] {
  if (!isMaintainer(actor)) throw forbidden("Maintainer access required.");
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT q.id, q.state, q.updated_at AS updatedAt, c.code AS courseCode, t.title AS topic, u.name AS authorName,
                r.stem AS stem, r.review_status AS reviewStatus
         FROM question q
         JOIN course c ON c.id = q.course_id
         JOIN topic t ON t.id = q.topic_id
         LEFT JOIN "user" u ON u.id = q.author_id
         LEFT JOIN question_revision r ON r.id = COALESCE(q.live_revision_id, (SELECT id FROM question_revision WHERE question_id = q.id ORDER BY number DESC LIMIT 1))
         WHERE q.deleted_at IS NULL
         ORDER BY q.updated_at DESC LIMIT ?`,
      )
      .all(Math.min(Math.max(limit, 1), 500)) as QuestionRow[]
  ).map((r) => (r.state === "draft" ? { ...r, stem: null } : r));
}
