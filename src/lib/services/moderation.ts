import { getDb, now, uid, type DB } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { isMaintainer, isReviewer, REVIEW_CHECKLIST, type Actor } from "../types";
import { reviewSchema } from "../validation";
import { z } from "zod";
import { logEvent } from "./events";

function requireReviewer(actor: Actor) {
  if (!isReviewer(actor)) throw forbidden("Reviewer access required.");
}

export function queue(actor: Actor) {
  requireReviewer(actor);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.id AS revisionId, r.number, r.stem, r.submitted_at AS submittedAt, r.flags, r.author_id AS authorId,
         q.id AS questionId, q.live_revision_id AS liveRevisionId, c.code AS courseCode, t.title AS topic, q.is_demo AS isDemo,
         u.name AS authorName
       FROM question_revision r JOIN question q ON q.id = r.question_id
       JOIN course c ON c.id = q.course_id JOIN topic t ON t.id = r.topic_id
       LEFT JOIN "user" u ON u.id = r.author_id
       WHERE r.state = 'pending' AND q.state != 'withdrawn' ORDER BY r.submitted_at`,
    )
    .all() as {
    revisionId: string; number: number; stem: string; submittedAt: string; flags: string; authorId: string | null;
    questionId: string; liveRevisionId: string | null; courseCode: string; topic: string; isDemo: number; authorName: string | null;
  }[];
  return rows.map((r) => ({
    revisionId: r.revisionId,
    questionId: r.questionId,
    number: r.number,
    stem: r.stem,
    submittedAt: r.submittedAt,
    courseCode: r.courseCode,
    topic: r.topic,
    isDemo: !!r.isDemo,
    authorName: r.authorName,
    isEdit: !!r.liveRevisionId,
    flags: JSON.parse(r.flags) as unknown[],
    ownSubmission: r.authorId === actor.id, // needs a second reviewer
  }));
}

export function getRevisionForReview(actor: Actor, revisionId: string) {
  requireReviewer(actor);
  const db = getDb();
  const r = db
    .prepare(
      `SELECT r.*, q.course_id AS courseId, q.state AS questionState, q.live_revision_id AS liveRevisionId, c.code AS courseCode,
         c.title AS courseTitle, t.title AS topicTitle, u.name AS authorName
       FROM question_revision r JOIN question q ON q.id = r.question_id JOIN course c ON c.id = q.course_id
       JOIN topic t ON t.id = r.topic_id LEFT JOIN "user" u ON u.id = r.author_id WHERE r.id = ?`,
    )
    .get(revisionId) as Record<string, unknown> | undefined;
  if (!r) throw notFound("Revision not found");
  const options = db.prepare("SELECT id, text, explanation FROM question_option WHERE revision_id = ? ORDER BY position").all(revisionId);
  const reviews = db
    .prepare(
      `SELECT rv.decision, rv.public_note AS publicNote, rv.private_note AS privateNote, rv.created_at AS createdAt, u.name AS reviewerName
       FROM review rv LEFT JOIN "user" u ON u.id = rv.reviewer_id WHERE rv.revision_id IN (SELECT id FROM question_revision WHERE question_id = ?)
       ORDER BY rv.created_at DESC`,
    )
    .all(r.question_id);
  const live = r.liveRevisionId
    ? db.prepare("SELECT stem FROM question_revision WHERE id = ?").get(r.liveRevisionId)
    : null;
  return { revision: { ...r, flags: JSON.parse(r.flags as string) }, options, reviews, liveStem: (live as { stem: string } | null)?.stem ?? null, canReview: r.author_id !== actor.id };
}

export function reviewRevision(actor: Actor, revisionId: string, raw: z.infer<typeof reviewSchema>) {
  requireReviewer(actor);
  const db = getDb();
  const input = reviewSchema.parse(raw);
  const r = db
    .prepare("SELECT r.id, r.state, r.author_id, r.number, r.question_id, r.topic_id, q.author_id AS qAuthor, q.state AS qState, q.live_revision_id AS live FROM question_revision r JOIN question q ON q.id = r.question_id WHERE r.id = ?")
    .get(revisionId) as { id: string; state: string; author_id: string | null; number: number; question_id: string; topic_id: string; qAuthor: string | null; qState: string; live: string | null } | undefined;
  if (!r) throw notFound("Revision not found");
  // Self-review is impossible regardless of role; a second reviewer is required for self-authored content.
  if (r.author_id === actor.id || r.qAuthor === actor.id) throw forbidden("You cannot review your own submission. Another reviewer must.");
  if (r.state !== "pending") throw conflict("not_pending", "This revision is not awaiting review.");
  if (r.qState === "withdrawn") throw conflict("withdrawn", "This question has been withdrawn.");

  if (input.decision === "approve") {
    const missing = REVIEW_CHECKLIST.filter((k) => input.checklist[k] !== true);
    if (missing.length) throw invalid("Every checklist item must be confirmed to approve.", { missing });
  } else if (!input.publicNote) {
    throw invalid("Explain what needs to change so the contributor can act on it.");
  }

  db.transaction(() => {
    const t = now();
    db.prepare("INSERT INTO review (id, revision_id, reviewer_id, decision, checklist, public_note, private_note, created_at) VALUES (?,?,?,?,?,?,?,?)").run(
      uid(), revisionId, actor.id, input.decision, JSON.stringify(input.checklist), input.publicNote || null, input.privateNote || null, t,
    );
    if (input.decision === "approve") {
      if (r.live) db.prepare("UPDATE question_revision SET state='superseded' WHERE id = ?").run(r.live);
      db.prepare("UPDATE question_revision SET state='approved', review_status='student_reviewed', reviewed_by=?, reviewed_at=? WHERE id=?").run(actor.id, t, revisionId);
      db.prepare("UPDATE question SET state='published', live_revision_id=?, topic_id=?, updated_at=? WHERE id=?").run(revisionId, r.topic_id, t, r.question_id);
    } else if (input.decision === "request_changes") {
      db.prepare("UPDATE question_revision SET state='changes_requested' WHERE id=?").run(revisionId);
      if (!r.live) db.prepare("UPDATE question SET state='changes_requested', updated_at=? WHERE id=?").run(t, r.question_id);
    } else {
      db.prepare("UPDATE question_revision SET state='rejected' WHERE id=?").run(revisionId);
      if (!r.live) db.prepare("UPDATE question SET state='rejected', updated_at=? WHERE id=?").run(t, r.question_id);
    }
  })();
  logEvent(actor.id, `review_${input.decision}`, { questionId: r.question_id, revisionId, detail: { number: r.number } });
  return { decision: input.decision };
}

export function withdrawQuestion(actor: Actor, questionId: string, reason: string, reportId?: string) {
  requireReviewer(actor);
  const db = getDb();
  const q = db.prepare("SELECT state FROM question WHERE id = ?").get(questionId) as { state: string } | undefined;
  if (!q) throw notFound("Question not found");
  const why = reason.trim();
  if (why.length < 5) throw invalid("Give a short reason for the withdrawal.");
  db.transaction(() => {
    db.prepare("UPDATE question SET state='withdrawn', withdrawn_reason=?, withdrawn_at=?, updated_at=? WHERE id=?").run(why.slice(0, 500), now(), now(), questionId);
    db.prepare("UPDATE question_revision SET state='withdrawn' WHERE question_id=? AND state IN ('pending','draft','changes_requested')").run(questionId);
    if (reportId) db.prepare("UPDATE report SET state='resolved', handled_by=?, resolution_note=?, updated_at=? WHERE id=?").run(actor.id, "Question withdrawn", now(), reportId);
  })();
  logEvent(actor.id, "withdrawn", { questionId, reportId, detail: { reason: why.slice(0, 200) } });
  return { state: "withdrawn" };
}

/** Maintainers only: put a withdrawn question with an approved live revision back in delivery. */
export function restoreQuestion(actor: Actor, questionId: string) {
  if (!isMaintainer(actor)) throw forbidden("Maintainer access required.");
  const db = getDb();
  const q = db.prepare("SELECT state, live_revision_id AS live FROM question WHERE id = ?").get(questionId) as { state: string; live: string | null } | undefined;
  if (!q) throw notFound("Question not found");
  if (q.state !== "withdrawn" || !q.live) throw conflict("cannot_restore", "Only withdrawn questions that were previously published can be restored.");
  db.prepare("UPDATE question SET state='published', withdrawn_reason=NULL, withdrawn_at=NULL, updated_at=? WHERE id=?").run(now(), questionId);
  logEvent(actor.id, "restored", { questionId });
  return { state: "published" };
}

export function listReports(actor: Actor, state?: string) {
  requireReviewer(actor);
  const where = state && ["open", "investigating", "resolved", "dismissed"].includes(state) ? "WHERE r.state = ?" : "WHERE r.state IN ('open','investigating')";
  return getDb()
    .prepare(
      `SELECT r.id, r.category, r.details, r.priority, r.state, r.created_at AS createdAt, r.resolution_note AS resolutionNote,
         r.question_id AS questionId, q.state AS questionState, rv.stem AS stem, c.code AS courseCode
       FROM report r LEFT JOIN question q ON q.id = r.question_id
       LEFT JOIN question_revision rv ON rv.id = COALESCE(r.revision_id, q.live_revision_id)
       LEFT JOIN course c ON c.id = q.course_id
       ${where} ORDER BY r.priority DESC, r.created_at`,
    )
    .all(...(where.includes("= ?") ? [state] : [])) as Record<string, unknown>[];
}

export function updateReport(actor: Actor, id: string, input: { state: string; note?: string }) {
  requireReviewer(actor);
  if (!["open", "investigating", "resolved", "dismissed"].includes(input.state)) throw invalid("Unknown report state.");
  const db = getDb();
  const rep = db.prepare("SELECT question_id AS questionId FROM report WHERE id = ?").get(id) as { questionId: string | null } | undefined;
  if (!rep) throw notFound("Report not found");
  db.prepare("UPDATE report SET state=?, resolution_note=?, handled_by=?, updated_at=? WHERE id=?").run(input.state, (input.note ?? "").slice(0, 1000) || null, actor.id, now(), id);
  logEvent(actor.id, `report_${input.state}`, { questionId: rep.questionId, reportId: id });
  return { state: input.state };
}

export function listCourseRequests(actor: Actor) {
  requireReviewer(actor);
  return getDb().prepare("SELECT id, code, title, note, created_at AS createdAt FROM course_request ORDER BY created_at DESC LIMIT 200").all();
}

export function listEvents(actor: Actor, questionId?: string) {
  if (!isMaintainer(actor)) throw forbidden("Maintainer access required.");
  const db: DB = getDb();
  return db
    .prepare(
      `SELECT e.id, e.action, e.question_id AS questionId, e.revision_id AS revisionId, e.report_id AS reportId, e.detail, e.created_at AS createdAt, u.name AS actorName
       FROM moderation_event e LEFT JOIN "user" u ON u.id = e.actor_id ${questionId ? "WHERE e.question_id = ?" : ""} ORDER BY e.created_at DESC LIMIT 200`,
    )
    .all(...(questionId ? [questionId] : []));
}
