import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { approve, freshDb, makeUser, seeded, validDraft, ALL_CHECKS } from "./helpers";
import { openDb, migrate } from "@/lib/db";
import { createDraft, submit } from "@/lib/services/contributions";
import { reviewRevision, verificationQueue, listEvents, queue } from "@/lib/services/moderation";
import { importBundledQuestionBank } from "@/lib/question-bank";
import { getCourse, getPublicQuestion, listCourses } from "@/lib/services/catalog";
import { createSession, getSessionState } from "@/lib/services/practice";
import { meetsVerificationBar, tally } from "@/lib/services/verification";
import { CHECKLIST_LABELS, REQUIRED_APPROVALS, REVIEW_CHECKLIST } from "@/lib/types";

const sql = (db: ReturnType<typeof freshDb>, text: string, ...args: unknown[]) => db.prepare(text).run(...args);

describe("tally", () => {
  it("uses each reviewer's latest decision and ignores authors and deleted accounts", () => {
    const t = tally(
      [
        { reviewerId: "a", decision: "approve" },
        { reviewerId: "b", decision: "request_changes" },
        { reviewerId: "b", decision: "approve" },
        { reviewerId: "author", decision: "approve" },
        { reviewerId: "c", decision: "approve" },
        { reviewerId: "c", decision: "request_changes" },
        { reviewerId: null, decision: "approve" },
      ],
      new Set(["author"]),
    );
    expect(t.approvers).toEqual(["a", "b"]);
    expect(t.objectors).toEqual(["c"]);
    expect(t.formerApprovals).toBe(1);
    expect(meetsVerificationBar(t)).toBe(false); // c objects
    expect(meetsVerificationBar(tally([{ reviewerId: "a", decision: "approve" }, { reviewerId: "b", decision: "approve" }]))).toBe(true);
    expect(meetsVerificationBar(tally([{ reviewerId: "a", decision: "approve" }, { reviewerId: "a", decision: "approve" }]))).toBe(false);
  });
});

describe("two-reviewer rule for new submissions", () => {
  it("publishes only after two different reviewers approve, and never counts the author", () => {
    const db = freshDb();
    const { demo101 } = seeded(db);
    const topicId = Object.values(demo101.topicIds)[0];
    const author = makeUser(db, "Author", "reviewer");
    const r1 = makeUser(db, "Reviewer One", "reviewer");
    const r2 = makeUser(db, "Reviewer Two", "reviewer");
    const { id, revisionId } = createDraft(author, validDraft(demo101.courseId, topicId));
    submit(author, id, true);

    expect(approve(r1, revisionId)).toMatchObject({ approvals: 1, required: REQUIRED_APPROVALS, verified: false, published: false });
    expect(() => getPublicQuestion(id)).toThrow(); // still pending: one approval is not enough
    expect(() => approve(r1, revisionId)).toThrow(/already approved/); // the same reviewer cannot approve twice
    expect(() => approve(author, revisionId)).toThrow(/own submission/);
    expect(queue(r2).find((q) => q.revisionId === revisionId)).toMatchObject({ approvals: 1, approvedByMe: false });
    expect(queue(r1).find((q) => q.revisionId === revisionId)).toMatchObject({ approvals: 1, approvedByMe: true });

    expect(approve(r2, revisionId)).toMatchObject({ approvals: 2, verified: true, published: true });
    const q = getPublicQuestion(id);
    expect(q.reviewStatus).toBe("student_reviewed");
    expect(q.verifiedBy.slice().sort()).toEqual(["Reviewer One", "Reviewer Two"]);
    expect(q.reviewedAt).toBeTruthy();
    db.close();
  });

  it("requires the independent-answer checklist item", () => {
    const db = freshDb();
    const { demo101 } = seeded(db);
    const author = makeUser(db, "Author");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const { id, revisionId } = createDraft(author, validDraft(demo101.courseId, Object.values(demo101.topicIds)[0]));
    submit(author, id, true);
    expect(REVIEW_CHECKLIST[0]).toBe("independent_answer");
    expect(CHECKLIST_LABELS.independent_answer).toBe("I independently worked out the correct answer before looking at the key.");
    expect(() => reviewRevision(rev, revisionId, { decision: "approve", checklist: { ...ALL_CHECKS, independent_answer: false }, publicNote: "", privateNote: "" })).toThrow(/checklist/i);
    db.close();
  });

  it("stops a pending submission when a reviewer asks for changes after the first approval", () => {
    const db = freshDb();
    const { demo101 } = seeded(db);
    const author = makeUser(db, "Author");
    const r1 = makeUser(db, "Reviewer One", "reviewer");
    const r2 = makeUser(db, "Reviewer Two", "reviewer");
    const r3 = makeUser(db, "Reviewer Three", "reviewer");
    const { id, revisionId } = createDraft(author, validDraft(demo101.courseId, Object.values(demo101.topicIds)[0]));
    submit(author, id, true);
    approve(r1, revisionId);
    reviewRevision(r2, revisionId, { decision: "request_changes", checklist: {}, publicNote: "Option C is also defensible.", privateNote: "" });
    expect(() => approve(r3, revisionId)).toThrow(/not awaiting/);
    expect(() => getPublicQuestion(id)).toThrow();
    db.close();
  });
});

describe("verifying the imported AI-generated questions", () => {
  it("imports everything unverified: the owner's review statement does not count", () => {
    const db = freshDb();
    importBundledQuestionBank(db);
    const verified = db.prepare("SELECT COUNT(*) AS n FROM question_revision WHERE review_status = 'student_reviewed'").get() as { n: number };
    expect(verified.n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM review").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM question_bank_import WHERE owner_review_note != ''").get() as { n: number }).n).toBe(300);
    const reviewer = makeUser(db, "Reviewer", "reviewer");
    expect(verificationQueue(reviewer)).toHaveLength(300);
    db.close();
  });

  it("verifies a live imported question after two independent approvals and records who verified it", () => {
    const db = freshDb();
    importBundledQuestionBank(db);
    const r1 = makeUser(db, "Reviewer One", "reviewer");
    const r2 = makeUser(db, "Reviewer Two", "reviewer");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const [first, second] = verificationQueue(r1);
    expect(approve(r1, first.revisionId)).toMatchObject({ kind: "verification", approvals: 1, verified: false });
    expect(getPublicQuestion(first.questionId).reviewStatus).toBe("unreviewed");
    // Questions with an approval move to the front, and the reviewer who approved no longer has to do them.
    expect(verificationQueue(r2)[0]).toMatchObject({ revisionId: first.revisionId, approvals: 1, decidedByMe: false });
    expect(verificationQueue(r1)[0]).toMatchObject({ revisionId: first.revisionId, decidedByMe: true });
    expect(() => approve(r1, first.revisionId)).toThrow(/already approved/);

    expect(approve(r2, first.revisionId)).toMatchObject({ approvals: 2, verified: true, published: false });
    const pub = getPublicQuestion(first.questionId);
    expect(pub.reviewStatus).toBe("student_reviewed");
    expect(pub.verifiedBy.slice().sort()).toEqual(["Reviewer One", "Reviewer Two"]);
    expect(verificationQueue(r1).some((i) => i.revisionId === first.revisionId)).toBe(false);
    expect(verificationQueue(r1).some((i) => i.revisionId === second.revisionId)).toBe(true);

    const events = listEvents(maint, first.questionId) as { action: string; actorName: string }[];
    expect(events.filter((e) => e.action === "verified").map((e) => e.actorName).sort()).toEqual(["Reviewer One", "Reviewer Two"]);
    expect(events.filter((e) => e.action === "review_approve")).toHaveLength(2);
    db.close();
  });

  it("blocks verification while a reviewer objects, and a rejection withdraws the question", () => {
    const db = freshDb();
    importBundledQuestionBank(db);
    const [a, b] = ["One", "Two"].map((n) => makeUser(db, `Reviewer ${n}`, "reviewer"));
    const c = makeUser(db, "Reviewer Three", "reviewer");
    const [item, other] = verificationQueue(a);
    approve(a, item.revisionId);
    reviewRevision(b, item.revisionId, { decision: "request_changes", checklist: {}, publicNote: "The key is wrong.", privateNote: "" });
    expect(verificationQueue(c).find((i) => i.revisionId === item.revisionId)).toMatchObject({ objected: true });
    expect(approve(c, item.revisionId)).toMatchObject({ approvals: 2, verified: false }); // 2 approvals, but b still objects
    expect(getPublicQuestion(item.questionId).reviewStatus).toBe("unreviewed");
    approve(b, item.revisionId); // b changes their mind
    expect(getPublicQuestion(item.questionId).reviewStatus).toBe("student_reviewed");

    expect(() => reviewRevision(a, other.revisionId, { decision: "reject", checklist: {}, publicNote: "no", privateNote: "" })).toThrow(/reason/);
    expect(reviewRevision(a, other.revisionId, { decision: "reject", checklist: {}, publicNote: "The key is factually wrong.", privateNote: "" })).toMatchObject({ withdrawn: true });
    expect(() => getPublicQuestion(other.questionId)).toThrow();
    db.close();
  });
});

describe("database guard", () => {
  it("refuses to mark a revision verified without two independent approvals", () => {
    const db = freshDb();
    importBundledQuestionBank(db);
    const rev = makeUser(db, "Reviewer", "reviewer");
    const [item] = verificationQueue(rev);
    expect(() => sql(db, "UPDATE question_revision SET review_status='student_reviewed' WHERE id = ?", item.revisionId)).toThrow(/two independent reviewers/);
    approve(rev, item.revisionId);
    expect(() => sql(db, "UPDATE question_revision SET review_status='student_reviewed' WHERE id = ?", item.revisionId)).toThrow(/two independent reviewers/);
    // a duplicate approval row from the same reviewer does not make two
    sql(db, "INSERT INTO review (id, revision_id, reviewer_id, decision, checklist, created_at) VALUES ('dup', ?, ?, 'approve', '{}', datetime('now'))", item.revisionId, rev.id);
    expect(() => sql(db, "UPDATE question_revision SET review_status='student_reviewed' WHERE id = ?", item.revisionId)).toThrow(/two independent reviewers/);
    expect(() => db.prepare(`INSERT INTO question_revision (id, question_id, number, state, topic_id, review_status, created_at) SELECT 'x', question_id, 99, 'draft', topic_id, 'student_reviewed', created_at FROM question_revision WHERE id = ?`).run(item.revisionId)).toThrow(/two independent reviewers/);
    db.close();
  });

  it("resets single-reviewer marks left over from the earlier rule and audits the reset", () => {
    const db = openDb(":memory:");
    db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    for (const f of fs.readdirSync("migrations").filter((f) => /^00[1-5]_/.test(f)).sort()) {
      db.exec(fs.readFileSync(path.join("migrations", f), "utf8"));
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(f);
    }
    const t = "2026-01-01T00:00:00.000Z";
    const user = (id: string) => db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?,?,?,0,?,?,?)').run(id, id, `${id}@example.test`, t, t, "reviewer");
    ["author", "r1", "r2"].forEach(user);
    const western = (db.prepare("SELECT id FROM university WHERE slug = 'western'").get() as { id: string }).id; // seeded by migration 003
    db.prepare("INSERT INTO course (id, university_id, slug, code, title, subject, created_at) VALUES ('c',?,'c','C1','C','S',?)").run(western, t);
    db.prepare("INSERT INTO unit (id, course_id, title) VALUES ('un','c','U')").run();
    db.prepare("INSERT INTO topic (id, unit_id, course_id, title) VALUES ('t','un','c','T')").run();
    for (const [qid, rid, approvers] of [["q1", "rev1", ["r1"]], ["q2", "rev2", ["r1", "r2"]]] as const) {
      db.prepare("INSERT INTO question (id, course_id, topic_id, author_id, state, live_revision_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(qid, "c", "t", "author", "published", rid, t, t);
      db.prepare("INSERT INTO question_revision (id, question_id, number, author_id, state, topic_id, review_status, reviewed_by, reviewed_at, created_at) VALUES (?,?,1,'author','approved','t','student_reviewed','r1',?,?)").run(rid, qid, t, t);
      approvers.forEach((a, i) => db.prepare("INSERT INTO review (id, revision_id, reviewer_id, decision, created_at) VALUES (?,?,?,'approve',?)").run(`${rid}-${i}`, rid, a, t));
    }
    expect(migrate(db)).toContain("006_two_reviewer_verification.sql");
    const status = (id: string) => (db.prepare("SELECT review_status, reviewed_by FROM question_revision WHERE id = ?").get(id) as { review_status: string; reviewed_by: string | null });
    expect(status("rev1")).toEqual({ review_status: "unreviewed", reviewed_by: null });
    expect(status("rev2").review_status).toBe("student_reviewed");
    const events = db.prepare("SELECT revision_id, action FROM moderation_event").all();
    expect(events).toEqual([{ revision_id: "rev1", action: "verification_reset" }]);
    db.close();
  });
});

describe("what learners see", () => {
  it("counts verified vs total per course and defaults practice to verified questions only", () => {
    const db = freshDb();
    importBundledQuestionBank(db);
    const bio = () => getCourse("biochem-2280a");
    expect(bio()).toMatchObject({ verifiedCount: 0, unverifiedCount: 150, totalCount: 150 });
    expect(listCourses().find((c) => c.slug === "chem-2213a")).toMatchObject({ verifiedCount: 0, totalCount: 150 });
    // Nothing is verified yet: the default refuses and says why; opting in works.
    expect(() => createSession(null, { courseId: bio().id, count: 5, mode: "practice", includeUnverified: false })).toThrow(/No verified questions/);
    expect(createSession(null, { courseId: bio().id, count: 5, mode: "practice", includeUnverified: true }).total).toBe(5);

    const [r1, r2] = ["One", "Two"].map((n) => makeUser(db, `Reviewer ${n}`, "reviewer"));
    const item = verificationQueue(r1).find((i) => i.courseCode === "BIOCHEM 2280A")!;
    approve(r1, item.revisionId);
    approve(r2, item.revisionId);
    expect(bio()).toMatchObject({ verifiedCount: 1, unverifiedCount: 149, totalCount: 150 });
    expect(bio().units.flatMap((u) => u.topics).reduce((n, t) => n + t.verifiedCount, 0)).toBe(1);

    const onlyVerified = createSession(null, { courseId: bio().id, count: 10, mode: "practice", includeUnverified: false });
    expect(onlyVerified.total).toBe(1); // never padded with unverified questions
    const state = getSessionState(onlyVerified.id, null);
    expect(state.items[0].question).toMatchObject({ questionId: item.questionId, reviewStatus: "student_reviewed", verifiedBy: expect.arrayContaining(["Reviewer One", "Reviewer Two"]) });
    expect(state.items[0].question!.reviewedAt).toBeTruthy();
    // The default really is verified-only when the flag is left out.
    expect(createSession(null, { courseId: bio().id, count: 10, mode: "practice" } as never).total).toBe(1);
    const mixed = getSessionState(createSession(null, { courseId: bio().id, count: 50, mode: "practice", includeUnverified: true }).id, null);
    expect(mixed.items).toHaveLength(50);
    for (const i of mixed.items) expect(i.question!.reviewStatus === "student_reviewed").toBe(i.question!.verifiedBy.length === 2);
    db.close();
  });
});
