import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeUser, seeded, validDraft, publishNew, ALL_CHECKS } from "./helpers";
import { createDraft, updateDraft, submit, revise, getMine, listMine, withdrawOwn } from "@/lib/services/contributions";
import { reviewRevision, queue, withdrawQuestion, restoreQuestion, listReports, listEvents, updateReport } from "@/lib/services/moderation";
import { createSession, getSessionState, answerQuestion } from "@/lib/services/practice";
import { createReport } from "@/lib/services/reports";
import { deleteAccount } from "@/lib/services/account";
import { getPublicQuestion, listCourses } from "@/lib/services/catalog";
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

describe("submission validation", () => {
  it("requires exactly one correct answer, all explanations, and the attestation", () => {
    const author = makeUser(db, "Author");
    const noCorrect = createDraft(author, validDraft(...target(), { correctOptionId: null }));
    expect(() => submit(author, noCorrect.id, true)).toThrow(/fix the highlighted/i);

    const noExplanation = validDraft(...target());
    noExplanation.options[2].explanation = "";
    const d2 = createDraft(author, noExplanation);
    try {
      submit(author, d2.id, true);
      throw new Error("should fail");
    } catch (e) {
      const err = e as { details?: { errors: { field: string }[] } };
      expect(err.details?.errors.some((x) => x.field === "options.2.explanation")).toBe(true);
    }

    const ok = createDraft(author, validDraft(...target()));
    expect(() => submit(author, ok.id, false as unknown as true)).toThrow(/originality/i);
    expect(submit(author, ok.id, true).state).toBe("pending_review");
  });

  it("rejects too few/duplicate options, all-of-the-above and positional references", () => {
    const author = makeUser(db, "Author");
    const few = validDraft(...target());
    few.options = few.options.slice(0, 3);
    few.correctOptionId = few.options[0].id;
    expect(() => submit(author, createDraft(author, few).id, true)).toThrow();

    const dup = validDraft(...target());
    dup.options[1].text = "a while loop";
    expect(() => submit(author, createDraft(author, dup).id, true)).toThrow();

    const aota = validDraft(...target());
    aota.options[3].text = "All of the above";
    expect(() => submit(author, createDraft(author, aota).id, true)).toThrow();

    const pos = validDraft(...target());
    pos.options[3].text = "Both A and B";
    expect(() => submit(author, createDraft(author, pos).id, true)).toThrow();
  });

  it("rejects unknown fields such as files or images", () => {
    const author = makeUser(db, "Author");
    expect(() => createDraft(author, { ...validDraft(...target()), attachment: "data:application/pdf;base64,AAAA" })).toThrow();
    expect(() => createDraft(author, { ...validDraft(...target()), referenceUrl: "javascript:alert(1)" })).toThrow();
  });

  it("flags possible assessment content and duplicates for reviewers without blocking", () => {
    const author = makeUser(db, "Author");
    const { id } = createDraft(author, validDraft(...target(), { stem: "From the midterm exam: which structure lets a program repeat steps?" }));
    submit(author, id, true);
    const rev = makeUser(db, "Reviewer", "reviewer");
    const item = queue(rev).find((q) => q.questionId === id)!;
    expect(JSON.stringify(item.flags)).toContain("assessment_keywords");
  });
});

describe("review and publication", () => {
  it("lets a contributor neither publish nor approve their own submission", () => {
    const author = makeUser(db, "Author", "maintainer");
    const { id, revisionId } = createDraft(author, validDraft(...target()));
    submit(author, id, true);
    expect(() => reviewRevision(author, revisionId, { decision: "approve", checklist: ALL_CHECKS, publicNote: "", privateNote: "" })).toThrow(/own submission/);
    const student = makeUser(db, "Student");
    expect(() => reviewRevision(student, revisionId, { decision: "approve", checklist: ALL_CHECKS, publicNote: "", privateNote: "" })).toThrow(/Reviewer access/);
    expect(() => queue(student)).toThrow();
    expect(() => getPublicQuestion(id)).toThrow();
    // a second reviewer can
    const rev = makeUser(db, "Second", "reviewer");
    reviewRevision(rev, revisionId, { decision: "approve", checklist: ALL_CHECKS, publicNote: "", privateNote: "" });
    expect(getPublicQuestion(id).reviewStatus).toBe("student_reviewed");
  });

  it("requires every checklist item to approve and a note to request changes", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { id, revisionId } = createDraft(author, validDraft(...target()));
    submit(author, id, true);
    expect(() => reviewRevision(rev, revisionId, { decision: "approve", checklist: { ...ALL_CHECKS, one_answer: false }, publicNote: "", privateNote: "" })).toThrow(/checklist/i);
    expect(() => reviewRevision(rev, revisionId, { decision: "request_changes", checklist: {}, publicNote: "", privateNote: "" })).toThrow();
    reviewRevision(rev, revisionId, { decision: "request_changes", checklist: {}, publicNote: "Option B is too obviously wrong.", privateNote: "internal remark" });
    const mine = listMine(author)[0];
    expect(mine.state).toBe("changes_requested");
    expect(mine.requestedChanges).toBe("Option B is too obviously wrong.");
    expect(JSON.stringify(getMine(author, id))).not.toContain("internal remark"); // private notes never reach contributors
    expect(JSON.stringify(mine)).not.toContain("internal remark");
  });

  it("makes revisions require fresh review while the old version stays live and sessions stay pinned", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { questionId } = publishNew(db, author, rev, ...target());
    const session = createSession(null, { courseId: ctx.demo101.courseId, topicIds: [topicId], count: 1, mode: "practice", includeUnreviewed: false });
    const before = getSessionState(session.id, null);
    expect(before.items[0].question!.stem).toMatch(/repeat steps/);

    const { revisionId: r2 } = revise(author, questionId);
    updateDraft(author, questionId, validDraft(...target(), { stem: "Edited stem: which construct repeats steps while a condition remains true?" }));
    // still the old version live while the edit awaits review
    submit(author, questionId, true);
    expect(getPublicQuestion(questionId).stem).toMatch(/^Which structure/);
    expect(queue(rev).some((q) => q.revisionId === r2 && q.isEdit)).toBe(true);
    expect(() => revise(author, questionId)).toThrow(); // pending edit blocks another

    reviewRevision(rev, r2, { decision: "approve", checklist: ALL_CHECKS, publicNote: "", privateNote: "" });
    expect(getPublicQuestion(questionId).stem).toMatch(/^Edited stem/);
    // the in-flight session keeps its pinned (old) text and can still be answered
    const during = getSessionState(session.id, null);
    expect(during.items[0].question!.stem).toMatch(/^Which structure/);
    const it = during.items[0];
    expect(answerQuestion(session.id, null, { sessionQuestionId: it.id, optionId: it.question!.options[0].id }).saved).toBe(true);
  });

  it("restricts withdrawal to moderators and logs audit events", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { questionId } = publishNew(db, author, rev, ...target());
    expect(() => withdrawQuestion(author, questionId, "I want it gone")).toThrow();
    withdrawQuestion(rev, questionId, "Possible assessment content");
    expect(() => getPublicQuestion(questionId)).toThrow();
    expect(() => restoreQuestion(rev, questionId)).toThrow(); // maintainers only
    restoreQuestion(maint, questionId);
    expect(getPublicQuestion(questionId).id).toBe(questionId);
    const actions = (listEvents(maint, questionId) as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["withdrawn", "restored", "review_approve", "submitted"]));
    expect(() => listEvents(rev)).toThrow();
  });

  it("lets authors withdraw their own contribution", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { questionId } = publishNew(db, author, rev, ...target());
    withdrawOwn(author, questionId);
    expect(() => getPublicQuestion(questionId)).toThrow();
    const other = makeUser(db, "Other");
    expect(() => withdrawOwn(other, questionId)).toThrow(/not found/i);
    expect(() => getMine(other, questionId)).toThrow(/not found/i);
  });
});

describe("reports and accounts", () => {
  it("queues reports without auto-removing content; prohibited reports get priority", () => {
    const qid = ctx.demo101.questionIds[0];
    const rev = makeUser(db, "Reviewer", "reviewer");
    createReport(null, "hash-a", { questionId: qid, category: "incorrect", details: "The explanation seems off." });
    const p = createReport(null, "hash-b", { questionId: qid, category: "prohibited", details: "Looks like a real exam." });
    expect(createReport(null, "hash-b", { questionId: qid, category: "prohibited", details: "again" }).duplicate).toBe(true);
    expect(getPublicQuestion(qid).id).toBe(qid); // still published
    const list = listReports(rev) as { id: string; priority: number }[];
    expect(list[0].id).toBe(p.id);
    expect(list[0].priority).toBe(1);
    updateReport(rev, p.id, { state: "dismissed", note: "Checked: not an exam." });
    expect((listReports(rev) as unknown[]).length).toBe(1);
    expect(() => listReports(makeUser(db, "Nope"))).toThrow();
  });

  it("deletes private data but keeps accepted contributions anonymously", () => {
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { questionId } = publishNew(db, author, rev, ...target());
    const { id: draftId } = createDraft(author, validDraft(...target()));
    createSession(author, { courseId: ctx.demo101.courseId, count: 2, mode: "practice", includeUnreviewed: true });
    deleteAccount(author.id);
    expect(db.prepare('SELECT 1 FROM "user" WHERE id = ?').get(author.id)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM practice_session WHERE user_id = ?").get(author.id)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM question WHERE id = ?").get(draftId)).toBeUndefined();
    const kept = db.prepare("SELECT author_id FROM question WHERE id = ?").get(questionId) as { author_id: string | null };
    expect(kept.author_id).toBeNull();
    expect(getPublicQuestion(questionId).id).toBe(questionId);
    expect(listCourses().length).toBe(3);
  });
});
