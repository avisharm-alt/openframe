import { getDb, uid, now, type DB } from "../db";
import { ATTESTATION_TEXT } from "../config";
import { ServiceError, conflict, forbidden, invalid, notFound } from "../errors";
import { isReviewer, type Actor } from "../types";
import { contentFlags, draftSchema, reviewerEditSchema, similarity, structuralCheck, type DraftInput } from "../validation";
import { logEvent } from "./events";

type QRow = {
  id: string;
  course_id: string;
  topic_id: string;
  author_id: string | null;
  state: string;
  live_revision_id: string | null;
  public_attribution: number;
};
type RevRow = {
  id: string;
  question_id: string;
  number: number;
  state: string;
  topic_id: string;
  stem: string;
  learning_objective: string;
  difficulty: string | null;
  context_tag: string | null;
  ai_provenance: string | null;
  ai_tool: string | null;
  ai_generated_on: string | null;
  check_description: string;
  reference_text: string | null;
  reference_url: string | null;
  correct_option_id: string | null;
  flags: string;
  submitted_at: string | null;
};

function ownQuestion(db: DB, actor: Actor, id: string): QRow {
  const q = db.prepare("SELECT * FROM question WHERE id = ?").get(id) as QRow | undefined;
  // 404 (not 403) for other people's questions so ids cannot be probed.
  if (!q || q.author_id !== actor.id) throw notFound("Contribution not found");
  return q;
}

const latest = (db: DB, qid: string) =>
  db.prepare("SELECT * FROM question_revision WHERE question_id = ? ORDER BY number DESC LIMIT 1").get(qid) as RevRow;

function assertTarget(db: DB, courseId: string, topicId: string) {
  const ok = db
    .prepare(
      `SELECT 1 FROM topic t JOIN course c ON c.id = t.course_id JOIN university u ON u.id = c.university_id
       WHERE t.id = ? AND c.id = ? AND c.status = 'active' AND u.enabled = 1`,
    )
    .get(topicId, courseId);
  if (!ok) throw invalid("That course/topic combination is not available for contributions.");
}

function writeOptions(db: DB, revisionId: string, options: DraftInput["options"]) {
  db.prepare("DELETE FROM question_option WHERE revision_id = ?").run(revisionId);
  const ins = db.prepare("INSERT INTO question_option (id, revision_id, position, text, explanation) VALUES (?,?,?,?,?)");
  options.forEach((o, i) => ins.run(o.id, revisionId, i, o.text, o.explanation));
}

function writeRevision(db: DB, revisionId: string, d: DraftInput) {
  const correct = d.correctOptionId && d.options.some((o) => o.id === d.correctOptionId) ? d.correctOptionId : null;
  db.prepare(
    `UPDATE question_revision SET topic_id=?, stem=?, learning_objective=?, difficulty=?, context_tag=?, ai_provenance=?, ai_tool=?,
       ai_generated_on=?, check_description=?, reference_text=?, reference_url=?, correct_option_id=? WHERE id=?`,
  ).run(
    d.topicId, d.stem, d.learningObjective, d.difficulty ?? null, d.contextTag || null, d.aiProvenance ?? null, d.aiTool || null,
    d.aiGeneratedOn || null, d.checkDescription, d.referenceText || null, d.referenceUrl || null, correct, revisionId,
  );
  writeOptions(db, revisionId, d.options);
}

function readDraft(db: DB, q: QRow, r: RevRow): DraftInput {
  const options = db
    .prepare("SELECT id, text, explanation FROM question_option WHERE revision_id = ? ORDER BY position")
    .all(r.id) as { id: string; text: string; explanation: string }[];
  return {
    courseId: q.course_id,
    topicId: r.topic_id,
    stem: r.stem,
    learningObjective: r.learning_objective,
    options,
    correctOptionId: r.correct_option_id,
    difficulty: r.difficulty as DraftInput["difficulty"],
    contextTag: r.context_tag ?? "",
    aiProvenance: r.ai_provenance as DraftInput["aiProvenance"],
    aiTool: r.ai_tool ?? "",
    aiGeneratedOn: r.ai_generated_on ?? "",
    checkDescription: r.check_description,
    referenceText: r.reference_text ?? "",
    referenceUrl: r.reference_url ?? "",
    publicAttribution: !!q.public_attribution,
  };
}

export function createDraft(actor: Actor, raw: unknown) {
  const db = getDb();
  const d = draftSchema.parse(raw);
  assertTarget(db, d.courseId, d.topicId);
  const qid = uid();
  const rid = uid();
  const t = now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO question (id, course_id, topic_id, author_id, public_attribution, state, created_at, updated_at) VALUES (?,?,?,?,?,'draft',?,?)",
    ).run(qid, d.courseId, d.topicId, actor.id, d.publicAttribution ? 1 : 0, t, t);
    db.prepare("INSERT INTO question_revision (id, question_id, number, author_id, state, topic_id, created_at) VALUES (?,?,1,?, 'draft', ?, ?)").run(rid, qid, actor.id, d.topicId, t);
    writeRevision(db, rid, d);
  })();
  logEvent(actor.id, "draft_created", { questionId: qid, revisionId: rid });
  return { id: qid, revisionId: rid };
}

export function updateDraft(actor: Actor, qid: string, raw: unknown) {
  const db = getDb();
  const q = ownQuestion(db, actor, qid);
  const r = latest(db, qid);
  if (r.state !== "draft") throw conflict("not_editable", "Only drafts can be edited. Start a new revision instead.");
  const d = draftSchema.parse(raw);
  if (d.courseId !== q.course_id) throw invalid("A question's course cannot be changed once created.");
  assertTarget(db, d.courseId, d.topicId);
  db.transaction(() => {
    writeRevision(db, r.id, d);
    // The question row mirrors the topic until a revision is approved for published questions.
    db.prepare("UPDATE question SET public_attribution=?, updated_at=?" + (q.live_revision_id ? "" : ", topic_id=?") + " WHERE id=?").run(
      ...(q.live_revision_id ? [d.publicAttribution ? 1 : 0, now(), qid] : [d.publicAttribution ? 1 : 0, now(), d.topicId, qid]),
    );
  })();
  return { id: qid, revisionId: r.id, checks: structuralCheck(d) };
}

/** Starts a new draft revision copied from the latest one (after changes were requested, or to edit a published question). */
export function revise(actor: Actor, qid: string) {
  const db = getDb();
  const q = ownQuestion(db, actor, qid);
  const r = latest(db, qid);
  if (!["changes_requested", "published"].includes(q.state) || ["draft", "pending"].includes(r.state)) {
    throw conflict("cannot_revise", "This contribution cannot be revised right now.");
  }
  const rid = uid();
  db.transaction(() => {
    db.prepare("INSERT INTO question_revision (id, question_id, number, author_id, state, topic_id, created_at) VALUES (?,?,?,?, 'draft', ?, ?)").run(
      rid, qid, r.number + 1, actor.id, r.topic_id, now(),
    );
    writeRevision(db, rid, { ...readDraft(db, q, r), publicAttribution: !!q.public_attribution });
  })();
  logEvent(actor.id, "revision_started", { questionId: qid, revisionId: rid, detail: { number: r.number + 1 } });
  return { id: qid, revisionId: rid };
}

/** Anyone with a Google account can sign up, so cap how many submissions one person can park in the review queue. */
export const MAX_PENDING_PER_AUTHOR = 10;

export function submit(actor: Actor, qid: string, attested: true) {
  const db = getDb();
  if (attested !== true) throw invalid("You must accept the originality and permission statement.");
  const q = ownQuestion(db, actor, qid);
  const r = latest(db, qid);
  if (r.state !== "draft") throw conflict("not_draft", "Only drafts can be submitted.");
  const pending = (db.prepare("SELECT COUNT(*) AS n FROM question_revision WHERE author_id = ? AND state = 'pending'").get(actor.id) as { n: number }).n;
  if (pending >= MAX_PENDING_PER_AUTHOR) {
    throw new ServiceError(429, "too_many_pending", `You already have ${pending} submissions waiting for review. Please wait for some to be reviewed before submitting more.`);
  }
  const d = readDraft(db, q, r);
  assertTarget(db, q.course_id, r.topic_id);
  const { errors, warnings } = structuralCheck(d);
  if (errors.length) throw new ServiceError(422, "invalid", "Please fix the highlighted problems before submitting.", { errors, warnings });

  const flags: Record<string, unknown>[] = contentFlags(d).map((code) => ({ code }));
  const others = db
    .prepare(
      `SELECT q.id AS qid, r.stem FROM question q JOIN question_revision r
         ON r.id = COALESCE(q.live_revision_id, (SELECT id FROM question_revision WHERE question_id = q.id AND state='pending' ORDER BY number DESC LIMIT 1))
       WHERE q.course_id = ? AND q.id != ? AND q.state IN ('published','pending_review')`,
    )
    .all(q.course_id, qid) as { qid: string; stem: string }[];
  for (const o of others) {
    const s = similarity(d.stem, o.stem);
    if (s >= 0.5) flags.push({ code: "possible_duplicate", questionId: o.qid, similarity: Math.round(s * 100) / 100 });
  }

  db.transaction(() => {
    db.prepare("UPDATE question_revision SET state='pending', submitted_at=?, attested_at=?, attestation_text=?, flags=? WHERE id=?").run(
      now(), now(), ATTESTATION_TEXT, JSON.stringify(flags), r.id,
    );
    if (q.state === "draft" || q.state === "changes_requested") {
      db.prepare("UPDATE question SET state='pending_review', updated_at=? WHERE id=?").run(now(), qid);
    }
  })();
  logEvent(actor.id, "submitted", { questionId: qid, revisionId: r.id, detail: { number: r.number } });
  return { id: qid, state: "pending_review", warnings };
}

/**
 * A reviewer corrects a question while reviewing it. The correction is a new revision authored by the reviewer and submitted
 * straight to review, so it needs two approvals from other reviewers. The revision it was based on stays live (or, if it was a
 * pending submission, is superseded by the correction).
 */
export function editAsReviewer(actor: Actor, baseRevisionId: string, raw: unknown) {
  if (!isReviewer(actor)) throw forbidden("Reviewer access required.");
  const db = getDb();
  const input = reviewerEditSchema.parse(raw);
  const base = db.prepare("SELECT * FROM question_revision WHERE id = ?").get(baseRevisionId) as RevRow | undefined;
  if (!base) throw notFound("Revision not found");
  const q = db.prepare("SELECT * FROM question WHERE id = ?").get(base.question_id) as QRow;
  if (["withdrawn", "rejected"].includes(q.state)) throw conflict("closed", "This question has been closed, so it cannot be edited.");
  if (q.live_revision_id !== base.id && base.state !== "pending") throw conflict("not_editable", "Only the live revision or a revision awaiting review can be edited.");
  const other = db.prepare("SELECT 1 FROM question_revision WHERE question_id = ? AND state = 'pending' AND id != ?").get(q.id, base.id);
  if (other) throw conflict("edit_pending", "Another revision of this question is already awaiting review.");

  const merged: DraftInput = {
    ...readDraft(db, q, base),
    stem: input.stem,
    learningObjective: input.learningObjective,
    difficulty: input.difficulty,
    options: input.options,
    correctOptionId: input.correctOptionId,
  };
  const { errors, warnings } = structuralCheck(merged);
  if (errors.length) throw new ServiceError(422, "invalid", "Please fix the highlighted problems before saving.", { errors, warnings });

  const rid = uid();
  const t = now();
  const number = latest(db, q.id).number + 1;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO question_revision (id, question_id, number, author_id, state, topic_id, created_at, submitted_at, attested_at, attestation_text, flags)
       VALUES (?,?,?,?, 'pending', ?, ?, ?, ?, ?, ?)`,
    ).run(rid, q.id, number, actor.id, base.topic_id, t, t, t, ATTESTATION_TEXT, JSON.stringify(contentFlags(merged).map((code) => ({ code }))));
    writeRevision(db, rid, merged);
    if (base.state === "pending") db.prepare("UPDATE question_revision SET state='superseded' WHERE id = ?").run(base.id);
    db.prepare("UPDATE question SET updated_at = ? WHERE id = ?").run(t, q.id);
  })();
  logEvent(actor.id, "reviewer_edit", { questionId: q.id, revisionId: rid, detail: { number, basedOn: base.number, summary: input.summary } });
  return { questionId: q.id, revisionId: rid, number };
}

export function withdrawOwn(actor: Actor, qid: string) {
  const db = getDb();
  const q = ownQuestion(db, actor, qid);
  if (["withdrawn", "rejected"].includes(q.state)) throw conflict("terminal", "This contribution is already closed.");
  db.transaction(() => {
    db.prepare(
      "UPDATE question SET state='withdrawn', withdrawn_reason='Withdrawn by contributor', withdrawn_at=?, updated_at=? WHERE id=?",
    ).run(now(), now(), qid);
    db.prepare("UPDATE question_revision SET state='withdrawn' WHERE question_id=? AND state IN ('draft','pending','changes_requested')").run(qid);
  })();
  logEvent(actor.id, "withdrawn_by_author", { questionId: qid });
  return { id: qid, state: "withdrawn" };
}

export function listMine(actor: Actor) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT q.id, q.state, q.updated_at AS updatedAt, c.code AS courseCode, t.title AS topic, q.live_revision_id AS liveRevisionId
       FROM question q JOIN course c ON c.id = q.course_id JOIN topic t ON t.id = q.topic_id
       WHERE q.author_id = ? ORDER BY q.updated_at DESC`,
    )
    .all(actor.id) as { id: string; state: string; updatedAt: string; courseCode: string; topic: string; liveRevisionId: string | null }[];
  return rows.map((q) => {
    const r = latest(db, q.id);
    return {
      id: q.id,
      state: q.state,
      updatedAt: q.updatedAt,
      courseCode: q.courseCode,
      topic: q.topic,
      stem: r.stem,
      revisionNumber: r.number,
      revisionState: r.state,
      hasLive: !!q.liveRevisionId,
      requestedChanges: publicFeedback(db, r.id),
    };
  });
}

/** Contributor-facing reviewer feedback. Private reviewer notes are never returned here. */
function publicFeedback(db: DB, revisionId: string): string | null {
  const row = db
    .prepare("SELECT public_note AS note, decision FROM review WHERE revision_id = ? AND decision != 'approve' ORDER BY created_at DESC LIMIT 1")
    .get(revisionId) as { note: string | null } | undefined;
  return row?.note ?? null;
}

export function getMine(actor: Actor, qid: string) {
  const db = getDb();
  const q = ownQuestion(db, actor, qid);
  const r = latest(db, qid);
  const d = readDraft(db, q, r);
  return {
    id: qid,
    state: q.state,
    revisionId: r.id,
    revisionNumber: r.number,
    revisionState: r.state,
    hasLive: !!q.live_revision_id,
    requestedChanges: publicFeedback(db, r.id),
    draft: d,
    checks: structuralCheck(d),
  };
}

export type { DraftInput };
