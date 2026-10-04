import { getDb } from "../db";
import { forbidden } from "../errors";
import { isReviewer, type Actor } from "../types";
import { PUBLISHED } from "./catalog";

/** Flags need this many attempts, so a handful of guesses cannot condemn a question. */
export const MIN_ATTEMPTS_TO_FLAG = 30;
/** A question is flagged as too easy above this share correct, and too hard below the lower one. */
export const TOO_EASY_ABOVE = 0.95;
export const TOO_HARD_BELOW = 0.25;
/**
 * Below this many attempts the per-option breakdown is withheld, so that a count of one or two cannot be read as
 * "what this student chose". Only aggregates ever leave this module; individual attempts and sessions never do.
 */
export const MIN_ATTEMPTS_TO_SHOW_BREAKDOWN = 10;

export type FlagReason = "too_easy" | "too_hard" | "distractor_beats_key";
export const FLAG_LABELS: Record<FlagReason, string> = {
  too_easy: `More than ${TOO_EASY_ABOVE * 100}% answered correctly`,
  too_hard: `Fewer than ${TOO_HARD_BELOW * 100}% answered correctly`,
  distractor_beats_key: "A wrong option is picked more often than the key",
};

/**
 * Pure rule: should this question go back for re-review? `picks` has one entry per option with how often it was chosen.
 * Needs MIN_ATTEMPTS_TO_FLAG attempts; below that nothing is flagged, whatever the split.
 */
export function evaluateItem(picks: { isKey: boolean; count: number }[]): FlagReason[] {
  const attempts = picks.reduce((n, p) => n + p.count, 0);
  if (attempts < MIN_ATTEMPTS_TO_FLAG) return [];
  const keyCount = picks.filter((p) => p.isKey).reduce((n, p) => n + p.count, 0);
  const share = keyCount / attempts;
  const flags: FlagReason[] = [];
  if (share > TOO_EASY_ABOVE) flags.push("too_easy");
  if (share < TOO_HARD_BELOW) flags.push("too_hard");
  if (picks.some((p) => !p.isKey && p.count > keyCount)) flags.push("distractor_beats_key");
  return flags;
}

export type OptionStat = { optionId: string; text: string; isKey: boolean; picks: number | null; share: number | null };
export type ItemStat = {
  questionId: string;
  revisionId: string;
  courseCode: string;
  topic: string;
  stem: string;
  verified: boolean;
  /** Answered attempts on the live revision (skips and unfinished self-test answers are not counted). */
  attempts: number;
  /** Null while there are too few attempts to show a breakdown. */
  percentCorrect: number | null;
  options: OptionStat[];
  flags: FlagReason[];
};

/**
 * Per published question: attempts, % correct and how often each option is picked, for the live revision only (an edit starts
 * a fresh count, because the question is no longer the one students answered). Practice answers count straight away; self-test
 * answers count once the session is finished. Reviewers only; the result is aggregate counts and carries no student data.
 */
export function itemAnalysis(actor: Actor, opts: { courseId?: string; flaggedOnly?: boolean; withAttemptsOnly?: boolean } = {}): ItemStat[] {
  if (!isReviewer(actor)) throw forbidden("Reviewer access required.");
  const db = getDb();
  const questions = db
    .prepare(
      `SELECT q.id AS questionId, r.id AS revisionId, c.code AS courseCode, t.title AS topic, r.stem, r.correct_option_id AS keyId,
         r.review_status = 'student_reviewed' AS verified
       FROM question q JOIN question_revision r ON r.id = q.live_revision_id
       JOIN course c ON c.id = q.course_id JOIN topic t ON t.id = q.topic_id
       WHERE ${PUBLISHED} ${opts.courseId ? "AND q.course_id = ?" : ""} ORDER BY c.code, t.title, q.id`,
    )
    .all(...(opts.courseId ? [opts.courseId] : [])) as { questionId: string; revisionId: string; courseCode: string; topic: string; stem: string; keyId: string | null; verified: number }[];
  const counts = db
    .prepare(
      `SELECT sq.revision_id AS revisionId, a.selected_option_id AS optionId, COUNT(*) AS n
       FROM attempt a JOIN session_question sq ON sq.id = a.session_question_id
       JOIN practice_session s ON s.id = sq.session_id
       JOIN question q ON q.id = sq.question_id AND q.live_revision_id = sq.revision_id
       WHERE a.skipped = 0 AND a.selected_option_id IS NOT NULL AND (s.mode = 'practice' OR s.state = 'finished')
       GROUP BY sq.revision_id, a.selected_option_id`,
    )
    .all() as { revisionId: string; optionId: string; n: number }[];
  const byRevision = new Map<string, Map<string, number>>();
  for (const c of counts) (byRevision.get(c.revisionId) ?? byRevision.set(c.revisionId, new Map()).get(c.revisionId)!).set(c.optionId, c.n);
  const optionStmt = db.prepare("SELECT id, text FROM question_option WHERE revision_id = ? ORDER BY position");

  const out: ItemStat[] = [];
  for (const q of questions) {
    const picked = byRevision.get(q.revisionId) ?? new Map<string, number>();
    const options = optionStmt.all(q.revisionId) as { id: string; text: string }[];
    const attempts = options.reduce((n, o) => n + (picked.get(o.id) ?? 0), 0);
    if (opts.withAttemptsOnly && attempts === 0) continue;
    const shown = attempts >= MIN_ATTEMPTS_TO_SHOW_BREAKDOWN;
    const raw = options.map((o) => ({ isKey: o.id === q.keyId, count: picked.get(o.id) ?? 0 }));
    const flags = evaluateItem(raw);
    if (opts.flaggedOnly && !flags.length) continue;
    const keyCount = raw.filter((o) => o.isKey).reduce((n, o) => n + o.count, 0);
    out.push({
      questionId: q.questionId,
      revisionId: q.revisionId,
      courseCode: q.courseCode,
      topic: q.topic,
      stem: q.stem,
      verified: !!q.verified,
      attempts,
      percentCorrect: shown ? Math.round((keyCount / attempts) * 1000) / 10 : null,
      options: options.map((o, i) => ({
        optionId: o.id,
        text: o.text,
        isKey: raw[i].isKey,
        picks: shown ? raw[i].count : null,
        share: shown ? Math.round((raw[i].count / attempts) * 1000) / 10 : null,
      })),
      flags,
    });
  }
  // Flagged questions first, then the ones with the most evidence.
  return out.sort((a, b) => b.flags.length - a.flags.length || b.attempts - a.attempts);
}
