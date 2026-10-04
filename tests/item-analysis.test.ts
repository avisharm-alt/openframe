import { describe, expect, it } from "vitest";
import { freshDb, makeUser, seeded } from "./helpers";
import { uid, now, type DB } from "@/lib/db";
import { evaluateItem, itemAnalysis, MIN_ATTEMPTS_TO_FLAG } from "@/lib/services/item-analysis";

const picks = (key: number, ...wrong: number[]) => [{ isKey: true, count: key }, ...wrong.map((count) => ({ isKey: false, count }))];

describe("evaluateItem", () => {
  it("needs 30 attempts before flagging anything", () => {
    expect(MIN_ATTEMPTS_TO_FLAG).toBe(30);
    expect(evaluateItem(picks(29, 0, 0, 0))).toEqual([]); // 29 attempts, all correct
    expect(evaluateItem(picks(0, 29, 0, 0))).toEqual([]); // 29 attempts, none correct
    expect(evaluateItem(picks(30, 0, 0, 0))).toEqual(["too_easy"]);
  });

  it("flags above 95% and below 25% correct, but not exactly on the thresholds", () => {
    expect(evaluateItem(picks(39, 1, 0, 0))).toEqual(["too_easy"]); // 97.5%
    expect(evaluateItem(picks(38, 1, 1, 0))).toEqual([]); // exactly 95%
    expect(evaluateItem(picks(9, 11, 10, 10))).toContain("too_hard"); // 22.5%
    expect(evaluateItem(picks(10, 10, 10, 10))).toEqual([]); // exactly 25%, and no wrong option beats the key
  });

  it("flags a wrong option picked more often than the key (ties are fine)", () => {
    expect(evaluateItem(picks(12, 13, 3, 2))).toEqual(["distractor_beats_key"]);
    expect(evaluateItem(picks(13, 13, 2, 2))).toEqual([]);
    expect(evaluateItem(picks(8, 15, 4, 3))).toEqual(["distractor_beats_key"]);
  });
});

function record(db: DB, courseId: string, questionId: string, revisionId: string, optionId: string | null, n: number, o: { mode?: string; state?: string; userId?: string | null; skip?: boolean } = {}) {
  const correct = (db.prepare("SELECT correct_option_id AS k FROM question_revision WHERE id = ?").get(revisionId) as { k: string }).k;
  for (let i = 0; i < n; i++) {
    const sid = uid();
    const sqid = uid();
    db.prepare("INSERT INTO practice_session (id, user_id, mode, state, course_id, created_at) VALUES (?,?,?,?,?,?)").run(sid, o.userId ?? null, o.mode ?? "practice", o.state ?? "finished", courseId, now());
    db.prepare("INSERT INTO session_question (id, session_id, position, question_id, revision_id, option_order) VALUES (?,?,0,?,?,'[]')").run(sqid, sid, questionId, revisionId);
    db.prepare("INSERT INTO attempt (session_question_id, selected_option_id, skipped, is_correct, answered_at) VALUES (?,?,?,?,?)").run(sqid, o.skip ? null : optionId, o.skip ? 1 : 0, o.skip ? null : optionId === correct ? 1 : 0, now());
  }
}

describe("itemAnalysis", () => {
  function setup() {
    const db = freshDb();
    const { demo101 } = seeded(db);
    const rows = db.prepare("SELECT q.id AS questionId, q.live_revision_id AS revisionId, r.correct_option_id AS key FROM question q JOIN question_revision r ON r.id = q.live_revision_id WHERE q.course_id = ? ORDER BY q.id").all(demo101.courseId) as { questionId: string; revisionId: string; key: string }[];
    const wrong = (revisionId: string, key: string) => (db.prepare("SELECT id FROM question_option WHERE revision_id = ? AND id != ? ORDER BY position").all(revisionId, key) as { id: string }[]).map((x) => x.id);
    return { db, courseId: demo101.courseId, rows, wrong };
  }

  it("reports attempts, % correct and per-option picks, and flags only with enough evidence", () => {
    const { db, courseId, rows, wrong } = setup();
    const [easy, balanced, thin, tiny, miskeyed] = rows;
    record(db, courseId, easy.questionId, easy.revisionId, easy.key, 40);
    record(db, courseId, balanced.questionId, balanced.revisionId, balanced.key, 20);
    record(db, courseId, balanced.questionId, balanced.revisionId, wrong(balanced.revisionId, balanced.key)[0], 12);
    record(db, courseId, thin.questionId, thin.revisionId, thin.key, 5);
    record(db, courseId, thin.questionId, thin.revisionId, wrong(thin.revisionId, thin.key)[0], 12); // beats the key, but only 17 attempts
    record(db, courseId, tiny.questionId, tiny.revisionId, wrong(tiny.revisionId, tiny.key)[1], 2);
    record(db, courseId, miskeyed.questionId, miskeyed.revisionId, miskeyed.key, 10);
    record(db, courseId, miskeyed.questionId, miskeyed.revisionId, wrong(miskeyed.revisionId, miskeyed.key)[2], 20);

    const rev = makeUser(db, "Reviewer", "reviewer");
    const all = itemAnalysis(rev, { courseId });
    expect(all).toHaveLength(rows.length);
    const by = (id: string) => all.find((i) => i.questionId === id)!;

    expect(by(easy.questionId)).toMatchObject({ attempts: 40, percentCorrect: 100, flags: ["too_easy"] });
    expect(by(balanced.questionId)).toMatchObject({ attempts: 32, percentCorrect: 62.5, flags: [] });
    const keyOption = by(balanced.questionId).options.find((o) => o.isKey)!;
    expect(keyOption).toMatchObject({ picks: 20, share: 62.5 });
    expect(by(balanced.questionId).options.filter((o) => !o.isKey).map((o) => o.picks).sort()).toEqual([0, 0, 12]);
    expect(by(thin.questionId)).toMatchObject({ attempts: 17, flags: [] });
    expect(by(thin.questionId).options.some((o) => o.picks === 12)).toBe(true); // breakdown shown from 10 attempts
    expect(by(tiny.questionId)).toMatchObject({ attempts: 2, percentCorrect: null, flags: [] });
    expect(by(tiny.questionId).options.every((o) => o.picks === null && o.share === null)).toBe(true); // withheld below 10 attempts
    expect(by(miskeyed.questionId).flags).toEqual(["distractor_beats_key"]); // 10/30 correct is above 25%
    expect(by(rows[5].questionId)).toMatchObject({ attempts: 0, percentCorrect: null, flags: [] });

    expect(all.slice(0, 2).map((i) => i.questionId).sort()).toEqual([easy.questionId, miskeyed.questionId].sort()); // flagged first
    expect(itemAnalysis(rev, { courseId, flaggedOnly: true }).map((i) => i.questionId).sort()).toEqual([easy.questionId, miskeyed.questionId].sort());
    expect(itemAnalysis(rev, { courseId, withAttemptsOnly: true })).toHaveLength(5);
    db.close();
  });

  it("ignores skips, unfinished self-tests, withdrawn questions and attempts on superseded revisions", () => {
    const { db, courseId, rows } = setup();
    const [q] = rows;
    record(db, courseId, q.questionId, q.revisionId, q.key, 6);
    record(db, courseId, q.questionId, q.revisionId, null, 4, { skip: true });
    record(db, courseId, q.questionId, q.revisionId, q.key, 5, { mode: "self_test", state: "in_progress" }); // answers can still change
    record(db, courseId, q.questionId, q.revisionId, q.key, 3, { mode: "self_test", state: "finished" });
    const rev = makeUser(db, "Reviewer", "reviewer");
    expect(itemAnalysis(rev).find((i) => i.questionId === q.questionId)!.attempts).toBe(9);

    // a new live revision starts a fresh count
    const newRev = uid();
    db.prepare("INSERT INTO question_revision (id, question_id, number, state, topic_id, stem, correct_option_id, created_at) SELECT ?, question_id, 2, 'approved', topic_id, stem, correct_option_id, created_at FROM question_revision WHERE id = ?").run(newRev, q.revisionId);
    db.prepare("UPDATE question SET live_revision_id = ? WHERE id = ?").run(newRev, q.questionId);
    expect(itemAnalysis(rev).find((i) => i.questionId === q.questionId)!.attempts).toBe(0);

    db.prepare("UPDATE question SET state = 'withdrawn' WHERE id = ?").run(q.questionId);
    expect(itemAnalysis(rev).some((i) => i.questionId === q.questionId)).toBe(false);
    db.close();
  });

  it("is reviewer-only and exposes no student, session or per-attempt data", () => {
    const { db, courseId, rows } = setup();
    const student = makeUser(db, "Student");
    const [q] = rows;
    record(db, courseId, q.questionId, q.revisionId, q.key, 12, { userId: student.id });
    const sessionIds = (db.prepare("SELECT id FROM practice_session").all() as { id: string }[]).map((s) => s.id);
    expect(() => itemAnalysis(student)).toThrow(/Reviewer access/);
    const json = JSON.stringify(itemAnalysis(makeUser(db, "Reviewer", "reviewer")));
    expect(json).not.toContain(student.id);
    expect(json).not.toContain(student.name!);
    expect(sessionIds.some((id) => json.includes(id))).toBe(false);
    expect(json).not.toMatch(/userId|sessionId|selectedOption|answeredAt/);
    db.close();
  });
});
