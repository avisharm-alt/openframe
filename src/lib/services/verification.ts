import { getDb, type DB } from "../db";
import { REQUIRED_APPROVALS } from "../types";

export type Decision = "approve" | "request_changes" | "reject";
export type ReviewRow = { reviewerId: string | null; decision: Decision };
export type Tally = {
  /** Distinct reviewers whose latest decision is "approve". Authors and deleted accounts never count. */
  approvers: string[];
  /** Distinct reviewers whose latest decision asks for changes or rejects. */
  objectors: string[];
  /** Approvals whose reviewer account was later deleted. They still count towards display, never towards a new verification. */
  formerApprovals: number;
};

/**
 * Counts who currently approves a revision. `rows` must be oldest first so a reviewer's latest decision wins.
 * `excluded` holds everyone who wrote or edited the question: their reviews never count.
 */
export function tally(rows: ReviewRow[], excluded: ReadonlySet<string> = new Set()): Tally {
  const latest = new Map<string, Decision>();
  let formerApprovals = 0;
  for (const r of rows) {
    if (!r.reviewerId) {
      if (r.decision === "approve") formerApprovals++;
      continue;
    }
    if (excluded.has(r.reviewerId)) continue;
    latest.set(r.reviewerId, r.decision);
  }
  const approvers: string[] = [];
  const objectors: string[] = [];
  for (const [id, d] of latest) (d === "approve" ? approvers : objectors).push(id);
  return { approvers, objectors, formerApprovals };
}

/** Two independent approvals and nobody objecting to this revision. */
export const meetsVerificationBar = (t: Tally) => t.approvers.length >= REQUIRED_APPROVALS && t.objectors.length === 0;

/** Everyone who wrote the question or any revision of it. They can never review it. */
export function questionAuthorIds(db: DB, questionId: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT author_id AS id FROM question WHERE id = ? AND author_id IS NOT NULL
       UNION SELECT author_id FROM question_revision WHERE question_id = ? AND author_id IS NOT NULL`,
    )
    .all(questionId, questionId) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Tallies for many revisions in two queries. */
export function loadTallies(db: DB, revisionIds: string[]): Map<string, Tally> {
  const out = new Map<string, Tally>();
  if (!revisionIds.length) return out;
  const marks = revisionIds.map(() => "?").join(",");
  const reviews = db
    .prepare(`SELECT revision_id AS revisionId, reviewer_id AS reviewerId, decision FROM review WHERE revision_id IN (${marks}) ORDER BY rowid`)
    .all(...revisionIds) as (ReviewRow & { revisionId: string })[];
  const authors = db
    .prepare(
      `SELECT r.id AS revisionId, a.author_id AS authorId FROM question_revision r
         JOIN question_revision a ON a.question_id = r.question_id WHERE r.id IN (${marks}) AND a.author_id IS NOT NULL
       UNION SELECT r.id, q.author_id FROM question_revision r JOIN question q ON q.id = r.question_id
         WHERE r.id IN (${marks}) AND q.author_id IS NOT NULL`,
    )
    .all(...revisionIds, ...revisionIds) as { revisionId: string; authorId: string }[];
  const excluded = new Map<string, Set<string>>();
  for (const a of authors) (excluded.get(a.revisionId) ?? excluded.set(a.revisionId, new Set()).get(a.revisionId)!).add(a.authorId);
  const byRevision = new Map<string, ReviewRow[]>();
  for (const r of reviews) (byRevision.get(r.revisionId) ?? byRevision.set(r.revisionId, []).get(r.revisionId)!).push(r);
  for (const id of revisionIds) out.set(id, tally(byRevision.get(id) ?? [], excluded.get(id)));
  return out;
}

export const FORMER_REVIEWER = "a former reviewer";

/** Display names of the reviewers who verified each revision (empty for revisions that are not verified). */
export function verifierNames(revisionIds: string[], db: DB = getDb()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(revisionIds)];
  if (!unique.length) return out;
  const marks = unique.map(() => "?").join(",");
  const verified = db
    .prepare(`SELECT id FROM question_revision WHERE review_status = 'student_reviewed' AND id IN (${marks})`)
    .all(...unique) as { id: string }[];
  const tallies = loadTallies(db, verified.map((v) => v.id));
  const ids = [...new Set([...tallies.values()].flatMap((t) => t.approvers))];
  const names = new Map<string, string>();
  if (ids.length) {
    const rows = db.prepare(`SELECT id, name FROM "user" WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: string; name: string }[];
    for (const u of rows) names.set(u.id, u.name);
  }
  for (const [id, t] of tallies) {
    out.set(id, [...t.approvers.map((a) => names.get(a) ?? FORMER_REVIEWER), ...Array.from({ length: t.formerApprovals }, () => FORMER_REVIEWER)]);
  }
  return out;
}
