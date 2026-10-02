import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeUser, seeded, validDraft, publishNew } from "./helpers";
import { createDraft, getMine, listMine, publishAsMaintainer, revise, submit, updateDraft } from "@/lib/services/contributions";
import { deleteAnyQuestion, deleteOwnQuestion, listAllQuestions } from "@/lib/services/deletion";
import { listEvents, queue, restoreQuestion, withdrawQuestion } from "@/lib/services/moderation";
import { createSession, getSessionState } from "@/lib/services/practice";
import { getPublicQuestion } from "@/lib/services/catalog";
import type { DB } from "@/lib/db";

let db: DB;
let ctx: ReturnType<typeof seeded>;
let topicId: string;
beforeEach(() => {
  db = freshDb();
  ctx = seeded(db);
  topicId = Object.values(ctx.demo101.topicIds)[0];
});
const target = () => [ctx.demo101.courseId, topicId] as const;
const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const practise = (who: ReturnType<typeof makeUser> | null) =>
  createSession(who, { courseId: ctx.demo101.courseId, count: 50, mode: "practice", includeUnreviewed: true });

describe("authors deleting their own questions", () => {
  it("removes a draft entirely", () => {
    const author = makeUser(db, "Author");
    const { id } = createDraft(author, validDraft(...target()));
    expect(deleteOwnQuestion(author, id)).toEqual({ id, outcome: "removed" });
    expect(count("SELECT COUNT(*) AS n FROM question WHERE id = ?", id)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM question_revision WHERE question_id = ?", id)).toBe(0);
    expect(listMine(author)).toEqual([]);
    expect(() => getMine(author, id)).toThrow(/not found/i);
  });

  it("removes a published question nobody has practised, including its reviews and bookmarks", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { questionId } = publishNew(db, author, rev, ...target());
    db.prepare("INSERT INTO bookmark (user_id, question_id, created_at) VALUES (?,?,datetime('now'))").run(rev.id, questionId);
    expect(deleteOwnQuestion(author, questionId).outcome).toBe("removed");
    expect(count("SELECT COUNT(*) AS n FROM question WHERE id = ?", questionId)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM review")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM bookmark WHERE question_id = ?", questionId)).toBe(0);
    expect(() => getPublicQuestion(questionId)).toThrow();
    expect(queue(rev)).toEqual([]);
  });

  it("removes a pending submission from the review queue", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { id } = createDraft(author, validDraft(...target()));
    submit(author, id, true);
    expect(queue(rev).some((q) => q.questionId === id)).toBe(true);
    deleteOwnQuestion(author, id);
    expect(queue(rev).some((q) => q.questionId === id)).toBe(false);
  });

  it("keeps an empty anonymous shell when other students have practised it, and erases all content", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const student = makeUser(db, "Student");
    const { questionId } = publishNew(db, author, rev, ...target());
    db.prepare("INSERT INTO bookmark (user_id, question_id, created_at) VALUES (?,?,datetime('now'))").run(student.id, questionId);

    const session = practise(student);
    const before = getSessionState(session.id, student);
    const item = before.items.find((i) => i.question?.questionId === questionId)!;
    expect(item.status).toBe("available");

    expect(deleteOwnQuestion(author, questionId).outcome).toBe("erased");

    // the student's history still resolves, as "no longer available"
    const after = getSessionState(session.id, student);
    const same = after.items.find((i) => i.id === item.id)!;
    expect(same.status).toBe("unavailable");
    expect(same.question).toBeNull();

    // nothing of the author's content or identity remains
    const q = db.prepare("SELECT author_id, state, deleted_at, live_revision_id, public_attribution FROM question WHERE id = ?").get(questionId) as Record<string, unknown>;
    expect(q.author_id).toBeNull();
    expect(q.state).toBe("withdrawn");
    expect(q.deleted_at).toBeTruthy();
    expect(q.live_revision_id).toBeNull();
    expect(q.public_attribution).toBe(0);
    const revs = db.prepare("SELECT stem, check_description, learning_objective, attestation_text, author_id FROM question_revision WHERE question_id = ?").all(questionId) as Record<string, unknown>[];
    expect(revs.length).toBeGreaterThan(0);
    for (const r of revs) expect(Object.values(r).every((v) => v === "" || v === null)).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM question_option WHERE revision_id IN (SELECT id FROM question_revision WHERE question_id = ?)", questionId)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM review")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM bookmark WHERE question_id = ?", questionId)).toBe(0);

    // gone from learner, author and moderator views
    expect(() => getPublicQuestion(questionId)).toThrow();
    expect(listMine(author)).toEqual([]);
    expect(() => deleteOwnQuestion(author, questionId)).toThrow(/not found/i);
    const maint = makeUser(db, "Maintainer", "maintainer");
    expect(listAllQuestions(maint).some((r) => r.id === questionId)).toBe(false);
    // and cannot be withdrawn or restored back into existence
    expect(() => withdrawQuestion(rev, questionId, "should not apply")).toThrow(/not found/i);
    expect(() => restoreQuestion(maint, questionId)).toThrow();
  });

  it("never lets someone delete another person's question, and does not reveal that it exists", () => {
    const author = makeUser(db, "Author");
    const other = makeUser(db, "Other");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { questionId } = publishNew(db, author, rev, ...target());
    expect(() => deleteOwnQuestion(other, questionId)).toThrow(/not found/i);
    expect(() => deleteOwnQuestion(rev, questionId)).toThrow(/not found/i); // reviewers get no special power over others' work
    expect(() => deleteOwnQuestion(other, "00000000-0000-0000-0000-000000000000")).toThrow(/not found/i);
    expect(getPublicQuestion(questionId).id).toBe(questionId);
  });

  it("records an audit event without the question text", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { questionId } = publishNew(db, author, rev, ...target());
    deleteOwnQuestion(author, questionId);
    const events = listEvents(maint, questionId) as { action: string; detail: string }[];
    const e = events.find((x) => x.action === "deleted_by_author")!;
    expect(e).toBeTruthy();
    expect(JSON.stringify(events)).not.toMatch(/repeat steps/); // no content in the audit trail
  });
});

describe("maintainers deleting anything", () => {
  it("can delete any question with a reason, and logs it", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { questionId } = publishNew(db, author, rev, ...target());
    expect(() => deleteAnyQuestion(maint, questionId, "no")).toThrow(/reason/i);
    expect(deleteAnyQuestion(maint, questionId, "Contains copied material").outcome).toBe("removed");
    expect(() => getPublicQuestion(questionId)).toThrow();
    expect(() => deleteAnyQuestion(maint, questionId, "Already gone, try again")).toThrow(/not found/i);
    const e = (listEvents(maint, questionId) as { action: string; detail: string }[]).find((x) => x.action === "deleted_by_maintainer")!;
    expect(e.detail).toContain("Contains copied material");
  });

  it("can delete someone else's pending submission and their draft", () => {
    const author = makeUser(db, "Author");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const pending = createDraft(author, validDraft(...target()));
    submit(author, pending.id, true);
    const draft = createDraft(author, validDraft(...target(), { stem: "A different private draft question about loops?" }));
    deleteAnyQuestion(maint, pending.id, "Spam submission");
    deleteAnyQuestion(maint, draft.id, "Spam draft here");
    expect(listMine(author)).toEqual([]);
  });

  it("is limited to maintainers: students and reviewers cannot use it", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { questionId } = publishNew(db, author, rev, ...target());
    expect(() => deleteAnyQuestion(author, questionId, "my own question")).toThrow(/maintainer/i);
    expect(() => deleteAnyQuestion(rev, questionId, "reviewers only withdraw")).toThrow(/maintainer/i);
    expect(() => listAllQuestions(rev)).toThrow(/maintainer/i);
    expect(getPublicQuestion(questionId).id).toBe(questionId);
  });

  it("lists every question but keeps other people's draft text private", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { questionId } = publishNew(db, author, rev, ...target());
    const draft = createDraft(author, validDraft(...target(), { stem: "Secret draft stem that only the author should see?" }));
    const rows = listAllQuestions(maint);
    const pub = rows.find((r) => r.id === questionId)!;
    expect(pub.stem).toMatch(/repeat steps/);
    expect(pub.authorName).toBe("Author");
    const d = rows.find((r) => r.id === draft.id)!;
    expect(d.stem).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Secret draft stem");
  });
});

describe("maintainer publishing without review", () => {
  it("publishes the maintainer's own draft immediately, labelled unreviewed, and logs that review was skipped", () => {
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { id } = createDraft(maint, validDraft(...target()));
    expect(publishAsMaintainer(maint, id, true).state).toBe("published");
    const pub = getPublicQuestion(id);
    expect(pub.reviewStatus).toBe("unreviewed"); // "student-reviewed" would be untrue: nobody else checked it
    const session = practise(null);
    expect(getSessionState(session.id, null).items.some((i) => i.question?.questionId === id)).toBe(true);
    const actions = (listEvents(maint, id) as { action: string }[]).map((e) => e.action);
    expect(actions).toContain("published_without_review");
  });

  it("still requires the originality statement and a structurally valid question", () => {
    const maint = makeUser(db, "Maintainer", "maintainer");
    const ok = createDraft(maint, validDraft(...target()));
    expect(() => publishAsMaintainer(maint, ok.id, false as unknown as true)).toThrow(/originality/i);
    const bad = createDraft(maint, validDraft(...target(), { correctOptionId: null }));
    expect(() => publishAsMaintainer(maint, bad.id, true)).toThrow(/fix the highlighted/i);
    expect(() => getPublicQuestion(bad.id)).toThrow();
  });

  it("is not available to students or reviewers, and not for someone else's draft", () => {
    const student = makeUser(db, "Student");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const mine = createDraft(student, validDraft(...target()));
    expect(() => publishAsMaintainer(student, mine.id, true)).toThrow(/maintainer/i);
    const rd = createDraft(rev, validDraft(...target(), { stem: "Reviewer draft about repeating steps while true?" }));
    expect(() => publishAsMaintainer(rev, rd.id, true)).toThrow(/maintainer/i);
    expect(() => publishAsMaintainer(maint, mine.id, true)).toThrow(/not found/i); // others' drafts stay private
    expect(() => getPublicQuestion(mine.id)).toThrow();
  });

  it("can publish an edit of its own published question, superseding the earlier version", () => {
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { id } = createDraft(maint, validDraft(...target()));
    publishAsMaintainer(maint, id, true);
    revise(maint, id);
    updateDraft(maint, id, validDraft(...target(), { stem: "Edited: which construct repeats steps while a condition remains true?" }));
    publishAsMaintainer(maint, id, true);
    expect(getPublicQuestion(id).stem).toMatch(/^Edited/);
    expect(count("SELECT COUNT(*) AS n FROM question_revision WHERE question_id = ? AND state = 'superseded'", id)).toBe(1);
    expect(() => publishAsMaintainer(maint, id, true)).toThrow(/drafts/i); // nothing left to publish
  });
});
