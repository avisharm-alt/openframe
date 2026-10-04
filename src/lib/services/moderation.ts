import { getDb, now, uid, type DB } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { isMaintainer, isReviewer, REQUIRED_APPROVALS, REVIEW_CHECKLIST, type Actor } from "../types";
import { reviewSchema } from "../validation";
import { z } from "zod";
import { logEvent } from "./events";
import { loadTallies, meetsVerificationBar, questionAuthorIds, type Tally } from "./verification";

function requireReviewer(actor: Actor) {
  if (!isReviewer(actor)) throw forbidden("Reviewer access required.");
}

/** SQL: true when the person (@me) wrote the question or any revision of it. Such people can never review it. */
const WROTE_IT = `(q.author_id = @me OR EXISTS (SELECT 1 FROM question_revision wa WHERE wa.question_id = q.id AND wa.author_id = @me))`;

/** Submissions and edits waiting for their first decisions. Publishing needs REQUIRED_APPROVALS independent approvals. */
export function queue(actor: Actor) {
  requireReviewer(actor);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.id AS revisionId, r.number, r.stem, r.submitted_at AS submittedAt, r.flags,
         q.id AS questionId, q.live_revision_id AS liveRevisionId, c.code AS courseCode, t.title AS topic, q.is_demo AS isDemo,
         u.name AS authorName, ${WROTE_IT} AS wroteIt
       FROM question_revision r JOIN question q ON q.id = r.question_id
       JOIN course c ON c.id = q.course_id JOIN topic t ON t.id = r.topic_id
       LEFT JOIN "user" u ON u.id = r.author_id
       WHERE r.state = 'pending' AND q.state != 'withdrawn' ORDER BY r.submitted_at`,
    )
    .all({ me: actor.id }) as {
    revisionId: string; number: number; stem: string; submittedAt: string; flags: string;
    questionId: string; liveRevisionId: string | null; courseCode: string; topic: string; isDemo: number; authorName: string | null; wroteIt: number;
  }[];
  const tallies = loadTallies(db, rows.map((r) => r.revisionId));
  return rows.map((r) => {
    const t = tallies.get(r.revisionId)!;
    return {
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
      ownSubmission: !!r.wroteIt, // needs other reviewers
      approvals: t.approvers.length,
      required: REQUIRED_APPROVALS,
      approvedByMe: t.approvers.includes(actor.id),
    };
  });
}

export type VerifyItem = {
  revisionId: string;
  questionId: string;
  number: number;
  stem: string;
  courseId: string;
  courseCode: string;
  topic: string;
  isDemo: boolean;
  approvals: number;
  required: number;
  /** A reviewer asked for changes (or the latest word on it is not an approval), so it cannot be verified as it stands. */
  objected: boolean;
  /** I already gave a decision on this revision. */
  decidedByMe: boolean;
  /** I wrote or edited it, so another reviewer must verify it. */
  wroteIt: boolean;
};

/**
 * The "needs verification" queue: published questions whose live revision has not been verified (for example the AI-generated
 * Western imports). Ordered so that the questions closest to being verified come first, then by course and topic.
 */
export function verificationQueue(actor: Actor, opts: { courseId?: string } = {}): VerifyItem[] {
  requireReviewer(actor);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.id AS revisionId, q.id AS questionId, r.number, r.stem, c.id AS courseId, c.code AS courseCode, t.title AS topic, q.is_demo AS isDemo,
         ${WROTE_IT} AS wroteIt
       FROM question q JOIN question_revision r ON r.id = q.live_revision_id
       JOIN course c ON c.id = q.course_id AND c.status = 'active' JOIN topic t ON t.id = q.topic_id JOIN unit un ON un.id = t.unit_id
       WHERE q.state = 'published' AND r.review_status = 'unreviewed' ${opts.courseId ? "AND q.course_id = @course" : ""}
       ORDER BY c.code, un.position, t.position, q.created_at, q.id`,
    )
    .all(opts.courseId ? { me: actor.id, course: opts.courseId } : { me: actor.id }) as {
    revisionId: string; questionId: string; number: number; stem: string; courseId: string; courseCode: string; topic: string; isDemo: number; wroteIt: number;
  }[];
  const tallies = loadTallies(db, rows.map((r) => r.revisionId));
  const items = rows.map((r): VerifyItem => {
    const t = tallies.get(r.revisionId)!;
    return {
      revisionId: r.revisionId, questionId: r.questionId, number: r.number, stem: r.stem, courseId: r.courseId, courseCode: r.courseCode,
      topic: r.topic, isDemo: !!r.isDemo, approvals: t.approvers.length, required: REQUIRED_APPROVALS, objected: t.objectors.length > 0,
      decidedByMe: t.approvers.includes(actor.id) || t.objectors.includes(actor.id), wroteIt: !!r.wroteIt,
    };
  });
  const rank = (i: VerifyItem) => (i.objected ? 2 : i.approvals > 0 ? 0 : 1);
  return items.map((it, n) => ({ it, n })).sort((a, b) => rank(a.it) - rank(b.it) || a.n - b.n).map((x) => x.it);
}

/** Overall progress of the verification effort, for the moderation tab. */
export function verificationProgress(actor: Actor) {
  requireReviewer(actor);
  const row = getDb()
    .prepare(
      `SELECT SUM(r.review_status = 'student_reviewed') AS verified, COUNT(*) AS total
       FROM question q JOIN question_revision r ON r.id = q.live_revision_id WHERE q.state = 'published'`,
    )
    .get() as { verified: number | null; total: number };
  return { verified: row.verified ?? 0, total: row.total };
}

export type ReviewList = "submissions" | "verify";
export type ReviewNav = { list: ReviewList; position: number; total: number; prevId: string | null; nextId: string | null; todo: number };

/** Previous/next revision for a reviewer working through a queue, skipping items they cannot or need not review. */
export function reviewNavigation(actor: Actor, revisionId: string, list: ReviewList): ReviewNav {
  const items: { revisionId: string; actionable: boolean }[] =
    list === "verify"
      ? verificationQueue(actor).map((i) => ({ revisionId: i.revisionId, actionable: !i.wroteIt && !i.decidedByMe }))
      : queue(actor).map((i) => ({ revisionId: i.revisionId, actionable: !i.ownSubmission && !i.approvedByMe }));
  const at = items.findIndex((i) => i.revisionId === revisionId);
  const before = at < 0 ? [] : items.slice(0, at);
  const after = at < 0 ? items : items.slice(at + 1);
  return {
    list,
    position: at + 1,
    total: items.length,
    prevId: [...before].reverse().find((i) => i.actionable)?.revisionId ?? null,
    nextId: after.find((i) => i.actionable)?.revisionId ?? null,
    todo: items.filter((i) => i.actionable).length,
  };
}

type Target = {
  id: string; state: string; author_id: string | null; number: number; question_id: string; topic_id: string;
  reviewStatus: string; qState: string; live: string | null;
};
const loadTarget = (db: DB, id: string) =>
  db
    .prepare(
      `SELECT r.id, r.state, r.author_id, r.number, r.question_id, r.topic_id, r.review_status AS reviewStatus, q.state AS qState, q.live_revision_id AS live
       FROM question_revision r JOIN question q ON q.id = r.question_id WHERE r.id = ?`,
    )
    .get(id) as Target | undefined;

export type ReviewKind = "submission" | "verification";
/**
 * What a decision on this revision means.
 * - submission: a pending revision. It goes live once two independent reviewers approve it.
 * - verification: the live, still-unverified revision of a published question (for example an import). It is already
 *   served to learners as "Unverified" and becomes verified once two independent reviewers approve it.
 */
function kindOf(t: Target): ReviewKind | null {
  if (t.qState === "withdrawn") return null;
  if (t.state === "pending") return "submission";
  if (t.state === "approved" && t.id === t.live && t.qState === "published" && t.reviewStatus === "unreviewed") return "verification";
  return null;
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
  const target = loadTarget(db, revisionId)!;
  const kind = kindOf(target);
  const tally = loadTallies(db, [revisionId]).get(revisionId)!;
  const approverNames = tally.approvers.length
    ? (db.prepare(`SELECT name FROM "user" WHERE id IN (${tally.approvers.map(() => "?").join(",")})`).all(...tally.approvers) as { name: string }[]).map((u) => u.name)
    : [];
  const wroteIt = questionAuthorIds(db, String(r.question_id)).has(actor.id);
  return {
    revision: { ...r, flags: JSON.parse(r.flags as string) },
    options,
    reviews,
    liveStem: (live as { stem: string } | null)?.stem ?? null,
    kind,
    wroteIt,
    canReview: !wroteIt && kind !== null && !tally.approvers.includes(actor.id),
    alreadyApproved: tally.approvers.includes(actor.id),
    approvals: tally.approvers.length,
    required: REQUIRED_APPROVALS,
    approvedBy: approverNames,
    objected: tally.objectors.length > 0,
    /** Reviewers may edit the live revision or a pending one; the edit becomes a new revision that needs fresh approvals. */
    canEdit: target.qState !== "withdrawn" && target.qState !== "rejected" && (target.state === "pending" || target.id === target.live),
  };
}

type ReviewOutcome = { decision: z.infer<typeof reviewSchema>["decision"]; kind: ReviewKind; approvals: number; required: number; verified: boolean; published: boolean; withdrawn: boolean };

export function reviewRevision(actor: Actor, revisionId: string, raw: z.infer<typeof reviewSchema>): ReviewOutcome {
  requireReviewer(actor);
  const db = getDb();
  const input = reviewSchema.parse(raw);
  const r = loadTarget(db, revisionId);
  if (!r) throw notFound("Revision not found");
  // Self-review is impossible regardless of role: neither the question's author nor anyone who edited it may review it.
  if (questionAuthorIds(db, r.question_id).has(actor.id)) throw forbidden("You cannot review your own submission. Another reviewer must.");
  if (r.qState === "withdrawn") throw conflict("withdrawn", "This question has been withdrawn.");
  const kind = kindOf(r);
  if (!kind) throw conflict("not_pending", "This revision is not awaiting review or verification.");

  const before = loadTallies(db, [revisionId]).get(revisionId)!;
  if (input.decision === "approve") {
    const missing = REVIEW_CHECKLIST.filter((k) => input.checklist[k] !== true);
    if (missing.length) throw invalid("Every checklist item must be confirmed to approve.", { missing });
    if (before.approvers.includes(actor.id)) throw conflict("already_approved", "You already approved this revision. A different reviewer must give the next approval.");
  } else if (!input.publicNote) {
    throw invalid("Explain what needs to change so the contributor can act on it.");
  } else if (input.decision === "reject" && kind === "verification" && input.publicNote.length < 5) {
    throw invalid("Rejecting a published question withdraws it. Give a short reason (at least 5 characters).");
  }

  const out: ReviewOutcome = { decision: input.decision, kind, approvals: before.approvers.length, required: REQUIRED_APPROVALS, verified: false, published: false, withdrawn: false };
  db.transaction(() => {
    const t = now();
    db.prepare("INSERT INTO review (id, revision_id, reviewer_id, decision, checklist, public_note, private_note, created_at) VALUES (?,?,?,?,?,?,?,?)").run(
      uid(), revisionId, actor.id, input.decision, JSON.stringify(input.checklist), input.publicNote || null, input.privateNote || null, t,
    );
    logEvent(actor.id, `review_${input.decision}`, { questionId: r.question_id, revisionId, detail: { number: r.number, kind } });
    if (input.decision === "approve") {
      const after: Tally = loadTallies(db, [revisionId]).get(revisionId)!;
      out.approvals = after.approvers.length;
      if (meetsVerificationBar(after)) {
        if (kind === "submission") {
          if (r.live) db.prepare("UPDATE question_revision SET state='superseded' WHERE id = ?").run(r.live);
          db.prepare("UPDATE question_revision SET state='approved', review_status='student_reviewed', reviewed_by=?, reviewed_at=? WHERE id=?").run(actor.id, t, revisionId);
          db.prepare("UPDATE question SET state='published', live_revision_id=?, topic_id=?, updated_at=? WHERE id=?").run(revisionId, r.topic_id, t, r.question_id);
          out.published = true;
        } else {
          db.prepare("UPDATE question_revision SET review_status='student_reviewed', reviewed_by=?, reviewed_at=? WHERE id=?").run(actor.id, t, revisionId);
        }
        out.verified = true;
        // Who verified what: one audit event per approving reviewer.
        for (const reviewerId of after.approvers) logEvent(reviewerId, "verified", { questionId: r.question_id, revisionId, detail: { number: r.number, published: out.published } });
      }
    } else if (input.decision === "request_changes") {
      // A live, unverified question stays served as "Unverified" but cannot be verified until it is edited or the objection is withdrawn.
      if (kind === "submission") {
        db.prepare("UPDATE question_revision SET state='changes_requested' WHERE id=?").run(revisionId);
        if (!r.live) db.prepare("UPDATE question SET state='changes_requested', updated_at=? WHERE id=?").run(t, r.question_id);
      }
    } else if (kind === "submission") {
      db.prepare("UPDATE question_revision SET state='rejected' WHERE id=?").run(revisionId);
      if (!r.live) db.prepare("UPDATE question SET state='rejected', updated_at=? WHERE id=?").run(t, r.question_id);
    } else {
      withdrawInTransaction(db, actor, r.question_id, input.publicNote.slice(0, 500));
      out.withdrawn = true;
    }
  })();
  return out;
}

function withdrawInTransaction(db: DB, actor: Actor, questionId: string, why: string, reportId?: string) {
  db.prepare("UPDATE question SET state='withdrawn', withdrawn_reason=?, withdrawn_at=?, updated_at=? WHERE id=?").run(why.slice(0, 500), now(), now(), questionId);
  db.prepare("UPDATE question_revision SET state='withdrawn' WHERE question_id=? AND state IN ('pending','draft','changes_requested')").run(questionId);
  if (reportId) db.prepare("UPDATE report SET state='resolved', handled_by=?, resolution_note=?, updated_at=? WHERE id=?").run(actor.id, "Question withdrawn", now(), reportId);
  logEvent(actor.id, "withdrawn", { questionId, reportId, detail: { reason: why.slice(0, 200) } });
}

export function withdrawQuestion(actor: Actor, questionId: string, reason: string, reportId?: string) {
  requireReviewer(actor);
  const db = getDb();
  const q = db.prepare("SELECT state FROM question WHERE id = ?").get(questionId) as { state: string } | undefined;
  if (!q) throw notFound("Question not found");
  const why = reason.trim();
  if (why.length < 5) throw invalid("Give a short reason for the withdrawal.");
  db.transaction(() => withdrawInTransaction(db, actor, questionId, why, reportId))();
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
  return getDb().prepare("SELECT cr.id, cr.code, cr.title, cr.note, u.name AS universityName, cr.created_at AS createdAt FROM course_request cr LEFT JOIN university u ON u.slug = cr.university_slug ORDER BY cr.created_at DESC LIMIT 200").all();
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
