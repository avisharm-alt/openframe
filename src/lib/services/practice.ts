import crypto from "node:crypto";
import { z } from "zod";
import { getDb, uid, now } from "../db";
import { ServiceError, conflict, invalid, notFound } from "../errors";
import type { Actor } from "../types";
import { PUBLISHED } from "./catalog";
import { verifierNames } from "./verification";
import { answerSchema, sessionCreateSchema } from "../validation";

type CreateInput = z.infer<typeof sessionCreateSchema>;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type SessionRow = {
  id: string;
  user_id: string | null;
  mode: "practice" | "self_test";
  state: "in_progress" | "finished" | "abandoned";
  course_id: string | null;
  timer_seconds: number | null;
  created_at: string;
  finished_at: string | null;
  config: string;
};

/** Sessions with a user are private to that user. Guest sessions are reachable only by their unguessable id. */
function loadSession(id: string, actor: Actor | null): SessionRow {
  const row = getDb().prepare("SELECT * FROM practice_session WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row || (row.user_id && row.user_id !== actor?.id)) throw notFound("Session not found");
  return row;
}

export function createSession(actor: Actor | null, input: CreateInput) {
  const db = getDb();
  let candidates: { questionId: string; revisionId: string }[];
  let courseId = input.courseId ?? null;

  if (input.retryFrom) {
    const src = loadSession(input.retryFrom, actor);
    if (src.state !== "finished") throw conflict("not_finished", "Finish the session before retrying missed questions.");
    const missed = getResults(src.id, actor).missed;
    if (!missed.length) throw invalid("There are no missed questions to retry.");
    const ids = missed.map((m) => m.questionId);
    candidates = db
      .prepare(
        `SELECT q.id AS questionId, q.live_revision_id AS revisionId FROM question q
         WHERE ${PUBLISHED} AND q.id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids) as typeof candidates;
    courseId = src.course_id;
  } else if (input.fromBookmarks) {
    if (!actor) throw new ServiceError(401, "unauthenticated", "Sign in to practice saved questions.");
    candidates = db
      .prepare(
        `SELECT q.id AS questionId, q.live_revision_id AS revisionId FROM bookmark b
         JOIN question q ON q.id = b.question_id WHERE b.user_id = ? AND ${PUBLISHED}
         ${courseId ? "AND q.course_id = ?" : ""}`,
      )
      .all(...(courseId ? [actor.id, courseId] : [actor.id])) as typeof candidates;
  } else {
    if (!courseId) throw invalid("Choose a course.");
    const params: unknown[] = [courseId];
    let sql = `SELECT q.id AS questionId, q.live_revision_id AS revisionId FROM question q
      JOIN question_revision r ON r.id = q.live_revision_id
      JOIN course c ON c.id = q.course_id AND c.status = 'active'
      WHERE ${PUBLISHED} AND q.course_id = ?`;
    if (input.topicIds?.length) {
      sql += ` AND q.topic_id IN (${input.topicIds.map(() => "?").join(",")})`;
      params.push(...input.topicIds);
    }
    if (input.difficulty) {
      sql += " AND r.difficulty = ?";
      params.push(input.difficulty);
    }
    // Default: verified questions only. Unverified ones are opt-in.
    if (!input.includeUnverified) sql += " AND r.review_status = 'student_reviewed'";
    candidates = db.prepare(sql).all(...params) as typeof candidates;
    if (!candidates.length && !input.includeUnverified) {
      const unverified = (db.prepare(sql.replace("AND r.review_status = 'student_reviewed'", "")).all(...params) as unknown[]).length;
      if (unverified) {
        throw new ServiceError(422, "no_verified_questions", "No questions match those settings. No verified questions are available for them; choose “Include unverified questions” to practise the unverified ones.");
      }
    }
  }

  if (!candidates.length) throw new ServiceError(422, "no_questions", "No questions match those settings.");
  // Never repeat questions to fill a session: take at most as many as exist.
  const picked = shuffle(candidates).slice(0, input.count);
  const sid = uid();
  const insertQ = db.prepare("INSERT INTO session_question (id, session_id, position, question_id, revision_id, option_order) VALUES (?,?,?,?,?,?)");
  db.transaction(() => {
    db.prepare(
      "INSERT INTO practice_session (id, user_id, mode, course_id, config, timer_seconds, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      sid,
      actor?.id ?? null,
      input.mode,
      courseId,
      JSON.stringify({ requested: input.count, difficulty: input.difficulty ?? null, includeUnverified: input.includeUnverified }),
      input.timerMinutes ? input.timerMinutes * 60 : null,
      now(),
    );
    picked.forEach((p, i) => {
      const optIds = (db.prepare("SELECT id FROM question_option WHERE revision_id = ?").all(p.revisionId) as { id: string }[]).map((o) => o.id);
      insertQ.run(uid(), sid, i, p.questionId, p.revisionId, JSON.stringify(shuffle(optIds)), );
    });
  })();
  return { id: sid, total: picked.length, requested: input.count };
}

type ItemRow = {
  sqId: string;
  position: number;
  questionId: string;
  revisionId: string;
  optionOrder: string;
  qState: string;
  isDemo: number;
  topicId: string;
  topic: string;
  courseCode: string;
  stem: string;
  difficulty: string | null;
  aiProvenance: string | null;
  aiTool: string | null;
  aiGeneratedOn: string | null;
  reviewStatus: string;
  reviewedAt: string | null;
  learningObjective: string;
  correctOptionId: string | null;
  checkDescription: string;
  referenceText: string | null;
  referenceUrl: string | null;
  selected: string | null;
  skipped: number | null;
  isCorrect: number | null;
  attempted: number | null;
};

function loadItems(sessionId: string): ItemRow[] {
  return getDb()
    .prepare(
      `SELECT sq.id AS sqId, sq.position, sq.question_id AS questionId, sq.revision_id AS revisionId, sq.option_order AS optionOrder,
         q.state AS qState, q.is_demo AS isDemo, r.topic_id AS topicId, t.title AS topic, c.code AS courseCode,
         r.stem, r.difficulty, r.ai_provenance AS aiProvenance, r.ai_tool AS aiTool, r.ai_generated_on AS aiGeneratedOn,
         r.review_status AS reviewStatus, r.reviewed_at AS reviewedAt, r.learning_objective AS learningObjective,
         r.correct_option_id AS correctOptionId, r.check_description AS checkDescription,
         r.reference_text AS referenceText, r.reference_url AS referenceUrl,
         a.selected_option_id AS selected, a.skipped, a.is_correct AS isCorrect, a.session_question_id AS attempted
       FROM session_question sq
       JOIN question q ON q.id = sq.question_id
       JOIN question_revision r ON r.id = sq.revision_id
       JOIN topic t ON t.id = r.topic_id
       JOIN course c ON c.id = q.course_id
       LEFT JOIN attempt a ON a.session_question_id = sq.id
       WHERE sq.session_id = ? ORDER BY sq.position`,
    )
    .all(sessionId) as ItemRow[];
}

const optionsOf = (revisionId: string) =>
  getDb().prepare("SELECT id, text, explanation FROM question_option WHERE revision_id = ?").all(revisionId) as { id: string; text: string; explanation: string }[];

/** An item is unavailable once its question has been withdrawn (or otherwise left the published state). */
const isAvailable = (i: ItemRow) => i.qState === "published";

export type SessionItem = {
  id: string;
  position: number;
  status: "available" | "unavailable";
  question: null | {
    stem: string;
    options: { id: string; text: string }[];
    difficulty: string | null;
    aiProvenance: string | null;
    aiTool: string | null;
    aiGeneratedOn: string | null;
    reviewStatus: string;
    reviewedAt: string | null;
    verifiedBy: string[];
    isDemo: boolean;
    topic: string;
    courseCode: string;
    questionId: string;
  };
  answer: null | { selectedOptionId: string | null; skipped: boolean };
  reveal: null | {
    correctOptionId: string | null;
    isCorrect: boolean | null;
    explanations: Record<string, string>;
    learningObjective: string;
    checkDescription: string;
    referenceText: string | null;
    referenceUrl: string | null;
  };
};

export function getSessionState(id: string, actor: Actor | null) {
  const s = loadSession(id, actor);
  const items = loadItems(id);
  const verifiers = verifierNames(items.map((i) => i.revisionId));
  const finished = s.state !== "in_progress";
  const out: SessionItem[] = items.map((i) => {
    const answer = i.attempted ? { selectedOptionId: i.selected, skipped: !!i.skipped } : null;
    if (!isAvailable(i)) {
      return { id: i.sqId, position: i.position, status: "unavailable", question: null, answer: null, reveal: null };
    }
    const opts = optionsOf(i.revisionId);
    const order = JSON.parse(i.optionOrder) as string[];
    const byId = new Map(opts.map((o) => [o.id, o]));
    // Reveal rules: practice mode after answering; any mode once the session is over. Self-test never leaks earlier.
    const reveal = finished || (s.mode === "practice" && i.selected !== null);
    return {
      id: i.sqId,
      position: i.position,
      status: "available" as const,
      question: {
        stem: i.stem,
        options: order.filter((x) => byId.has(x)).map((x) => ({ id: x, text: byId.get(x)!.text })),
        difficulty: i.difficulty,
        aiProvenance: i.aiProvenance,
        aiTool: i.aiTool,
        aiGeneratedOn: i.aiGeneratedOn,
        reviewStatus: i.reviewStatus,
        reviewedAt: i.reviewedAt,
        verifiedBy: verifiers.get(i.revisionId) ?? [],
        isDemo: !!i.isDemo,
        topic: i.topic,
        courseCode: i.courseCode,
        questionId: i.questionId,
      },
      answer,
      reveal: reveal
        ? {
            correctOptionId: i.correctOptionId,
            isCorrect: i.selected === null ? null : i.isCorrect === 1,
            explanations: Object.fromEntries(opts.map((o) => [o.id, o.explanation])),
            learningObjective: i.learningObjective,
            checkDescription: i.checkDescription,
            referenceText: i.referenceText,
            referenceUrl: i.referenceUrl,
          }
        : null,
    };
  });
  const deadline = s.timer_seconds ? new Date(Date.parse(s.created_at) + s.timer_seconds * 1000).toISOString() : null;
  return {
    id: s.id,
    mode: s.mode,
    state: s.state,
    createdAt: s.created_at,
    finishedAt: s.finished_at,
    deadline,
    requested: (JSON.parse(s.config) as { requested?: number }).requested ?? out.length,
    items: out,
    results: s.state === "finished" ? getResults(id, actor) : null,
  };
}

export function answerQuestion(id: string, actor: Actor | null, raw: z.infer<typeof answerSchema>) {
  const db = getDb();
  const s = loadSession(id, actor);
  if (s.state !== "in_progress") throw conflict("session_over", "This session has ended.");
  if (s.timer_seconds && Date.now() > Date.parse(s.created_at) + (s.timer_seconds + 10) * 1000) {
    throw conflict("time_up", "Time is up for this session.");
  }
  const item = loadItems(id).find((i) => i.sqId === raw.sessionQuestionId);
  if (!item) throw notFound("Question not in this session");
  if (!isAvailable(item)) throw conflict("unavailable", "This question is no longer available.");
  if (!raw.skip && !raw.optionId) throw invalid("Choose an option or skip.");
  if (s.mode === "practice" && item.selected !== null) throw conflict("already_answered", "You already answered this question.");

  if (raw.skip) {
    db.prepare(
      `INSERT INTO attempt (session_question_id, selected_option_id, skipped, is_correct, answered_at) VALUES (?,NULL,1,NULL,?)
       ON CONFLICT(session_question_id) DO UPDATE SET selected_option_id=NULL, skipped=1, is_correct=NULL, answered_at=excluded.answered_at`,
    ).run(item.sqId, now());
    return { saved: true };
  }
  const opts = optionsOf(item.revisionId);
  if (!opts.some((o) => o.id === raw.optionId)) throw invalid("That option does not belong to this question.");
  const correct = raw.optionId === item.correctOptionId ? 1 : 0;
  db.prepare(
    `INSERT INTO attempt (session_question_id, selected_option_id, skipped, is_correct, answered_at) VALUES (?,?,0,?,?)
     ON CONFLICT(session_question_id) DO UPDATE SET selected_option_id=excluded.selected_option_id, skipped=0, is_correct=excluded.is_correct, answered_at=excluded.answered_at`,
  ).run(item.sqId, raw.optionId, correct, now());
  if (s.mode === "self_test") return { saved: true }; // no key, no explanation until the session is finished
  return {
    saved: true,
    correct: !!correct,
    correctOptionId: item.correctOptionId,
    explanations: Object.fromEntries(opts.map((o) => [o.id, o.explanation])),
  };
}

export function finishSession(id: string, actor: Actor | null) {
  const s = loadSession(id, actor);
  if (s.state === "abandoned") throw conflict("session_over", "This session was abandoned.");
  if (s.state === "in_progress") {
    getDb().prepare("UPDATE practice_session SET state='finished', finished_at=? WHERE id=?").run(now(), id);
  }
  return getResults(id, actor);
}

export function abandonSession(id: string, actor: Actor | null) {
  const s = loadSession(id, actor);
  if (s.state === "in_progress") getDb().prepare("UPDATE practice_session SET state='abandoned', finished_at=? WHERE id=?").run(now(), id);
  return { abandoned: true };
}

export function deleteSession(id: string, actor: Actor | null) {
  loadSession(id, actor);
  getDb().prepare("DELETE FROM practice_session WHERE id = ?").run(id);
  return { deleted: true };
}

export type Results = {
  total: number;
  answered: number;
  correct: number;
  incorrect: number;
  skipped: number;
  unavailable: number;
  byTopic: { topic: string; answered: number; correct: number; total: number }[];
  missed: { sessionQuestionId: string; questionId: string }[];
};

/** Withdrawn questions are excluded from scoring and reported separately as "unavailable". */
export function getResults(id: string, actor: Actor | null): Results {
  loadSession(id, actor);
  const items = loadItems(id);
  const scored = items.filter(isAvailable);
  const answered = scored.filter((i) => i.selected !== null);
  const correct = answered.filter((i) => i.isCorrect === 1);
  const topics = new Map<string, { topic: string; answered: number; correct: number; total: number }>();
  for (const i of scored) {
    const t = topics.get(i.topicId) ?? { topic: i.topic, answered: 0, correct: 0, total: 0 };
    t.total++;
    if (i.selected !== null) t.answered++;
    if (i.isCorrect === 1) t.correct++;
    topics.set(i.topicId, t);
  }
  return {
    total: scored.length,
    answered: answered.length,
    correct: correct.length,
    incorrect: answered.length - correct.length,
    skipped: scored.length - answered.length,
    unavailable: items.length - scored.length,
    byTopic: [...topics.values()],
    missed: scored.filter((i) => i.isCorrect !== 1).map((i) => ({ sessionQuestionId: i.sqId, questionId: i.questionId })),
  };
}

export function listSessions(actor: Actor) {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.mode, s.state, s.created_at AS createdAt, c.code AS courseCode, c.title AS courseTitle
       FROM practice_session s LEFT JOIN course c ON c.id = s.course_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50`,
    )
    .all(actor.id) as { id: string; mode: string; state: string; createdAt: string; courseCode: string | null; courseTitle: string | null }[];
  return rows.map((r) => {
    if (r.state !== "finished") return { ...r, results: null };
    const x = getResults(r.id, actor);
    return { ...r, results: { total: x.total, correct: x.correct } };
  });
}
