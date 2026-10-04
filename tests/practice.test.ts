import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeUser, seeded, SEED_COURSES, publishNew } from "./helpers";
import { createSession, getSessionState, answerQuestion, finishSession, getResults } from "@/lib/services/practice";
import { getPublicQuestion, listCourses } from "@/lib/services/catalog";
import { addBookmark } from "@/lib/services/bookmarks";
import { createDraft } from "@/lib/services/contributions";
import { validDraft } from "./helpers";
import type { DB } from "@/lib/db";

let db: DB;
let ctx: ReturnType<typeof seeded>;
beforeEach(() => {
  db = freshDb();
  ctx = seeded(db);
});

const seedCorrectText = (stem: string) => {
  for (const c of SEED_COURSES) for (const q of c.questions) if (q.stem === stem) return q.options[q.correct][0];
  throw new Error("seed question not found");
};

describe("guest practice", () => {
  it("lets a guest complete a session and shows accurate results", () => {
    const { id, total } = createSession(null, { courseId: ctx.demo101.courseId, count: 5, mode: "practice", includeUnverified: true });
    expect(total).toBe(5);
    let state = getSessionState(id, null);
    // answer 3 correctly, 1 wrongly, skip 1
    state.items.forEach((item, idx) => {
      const q = item.question!;
      const correctId = q.options.find((o) => o.text === seedCorrectText(q.stem))!.id;
      const wrongId = q.options.find((o) => o.id !== correctId)!.id;
      if (idx < 3) expect(answerQuestion(id, null, { sessionQuestionId: item.id, optionId: correctId }).correct).toBe(true);
      else if (idx === 3) expect(answerQuestion(id, null, { sessionQuestionId: item.id, optionId: wrongId }).correct).toBe(false);
      else answerQuestion(id, null, { sessionQuestionId: item.id, skip: true });
    });
    const res = finishSession(id, null);
    expect(res).toMatchObject({ total: 5, answered: 4, correct: 3, incorrect: 1, skipped: 1 });
    expect(res.byTopic.reduce((n, t) => n + t.total, 0)).toBe(5);
    expect(res.missed).toHaveLength(2);
    state = getSessionState(id, null);
    expect(state.state).toBe("finished");
    expect(state.items.every((i) => i.reveal)).toBe(true);

    // retry-missed pins only the missed ones and never repeats to fill
    const retry = createSession(null, { retryFrom: id, count: 20, mode: "practice", includeUnverified: true });
    expect(retry.total).toBe(2);
  });

  it("never repeats questions to fill a session when fewer match", () => {
    const r = createSession(null, { courseId: ctx.demo101.courseId, count: 50, mode: "practice", includeUnverified: true });
    expect(r.total).toBe(8);
    const items = getSessionState(r.id, null).items;
    expect(new Set(items.map((i) => i.question!.questionId)).size).toBe(8);
  });

  it("excludes unreviewed questions by default", () => {
    expect(() => createSession(null, { courseId: ctx.demo101.courseId, count: 5, mode: "practice", includeUnverified: false })).toThrow(/No questions match/);
  });
});

describe("shuffling", () => {
  it("never changes the correct answer or explanation mapping", () => {
    const orders = new Set<string>();
    for (let n = 0; n < 15; n++) {
      const { id } = createSession(null, { courseId: ctx.demo101.courseId, count: 8, mode: "practice", includeUnverified: true });
      for (const item of getSessionState(id, null).items) {
        const q = item.question!;
        orders.add(q.options.map((o) => o.id).join());
        const pick = q.options.find((o) => o.text === seedCorrectText(q.stem))!;
        const r = answerQuestion(id, null, { sessionQuestionId: item.id, optionId: pick.id });
        expect(r.correct).toBe(true);
        expect(r.correctOptionId).toBe(pick.id);
        // each option's explanation is keyed by its stable id
        const seedQ = SEED_COURSES.flatMap((c) => c.questions).find((s) => s.stem === q.stem)!;
        for (const o of q.options) {
          const expected = seedQ.options.find(([t]) => t === o.text)![1];
          expect(r.explanations![o.id]).toBe(expected);
        }
      }
    }
    expect(orders.size).toBeGreaterThan(8); // options really are shuffled
  });
});

describe("self-test", () => {
  it("does not leak keys or explanations before completion", () => {
    const { id } = createSession(null, { courseId: ctx.demo101.courseId, count: 3, mode: "self_test", includeUnverified: true });
    const state = getSessionState(id, null);
    const resp = answerQuestion(id, null, { sessionQuestionId: state.items[0].id, optionId: state.items[0].question!.options[0].id });
    expect(resp).toEqual({ saved: true });
    const mid = getSessionState(id, null);
    expect(mid.items.every((i) => i.reveal === null)).toBe(true);
    expect(mid.results).toBeNull();
    const json = JSON.stringify(mid);
    for (const i of state.items) for (const o of SEED_COURSES.flatMap((c) => c.questions).find((s) => s.stem === i.question!.stem)!.options) {
      expect(json).not.toContain(o[1]); // no explanation text anywhere
    }
    expect(json).not.toContain("correctOptionId");
    // after finishing, everything is revealed
    finishSession(id, null);
    expect(getSessionState(id, null).items.every((i) => i.reveal)).toBe(true);
  });
});

describe("authorization and delivery", () => {
  it("keeps signed-in sessions private to their owner", () => {
    const a = makeUser(db, "Alice");
    const b = makeUser(db, "Bob");
    const { id } = createSession(a, { courseId: ctx.demo101.courseId, count: 2, mode: "practice", includeUnverified: true });
    expect(() => getSessionState(id, b)).toThrow(/not found/i);
    expect(() => getSessionState(id, null)).toThrow(/not found/i);
    expect(() => getResults(id, b)).toThrow();
    expect(() => finishSession(id, b)).toThrow();
    expect(getSessionState(id, a).id).toBe(id);
  });

  it("never delivers unpublished content through public paths", () => {
    const author = makeUser(db, "Author");
    const topicId = Object.values(ctx.demo101.topicIds)[0];
    const { id: draftId } = createDraft(author, validDraft(ctx.demo101.courseId, topicId));
    expect(() => getPublicQuestion(draftId)).toThrow(/not found/i);
    expect(() => addBookmark(author, draftId)).toThrow(/not found/i);
    const before = listCourses("DEMO-101")[0];
    expect(before.verifiedCount + before.unverifiedCount).toBe(8);
    // public view of a published question has no key or explanations
    const published = getPublicQuestion(ctx.demo101.questionIds[0]);
    expect(JSON.stringify(published)).not.toMatch(/explanation|correct/i);
  });

  it("hides, excludes from sessions and from scoring once withdrawn", async () => {
    const mod = makeUser(db, "Mod", "reviewer");
    const { withdrawQuestion } = await import("@/lib/services/moderation");
    const user = makeUser(db, "Learner");
    addBookmark(user, ctx.demo101.questionIds[0]);
    const { id } = createSession(user, { courseId: ctx.demo101.courseId, count: 4, mode: "practice", includeUnverified: true });
    const state = getSessionState(id, user);
    const victim = state.items[0];
    const victimQ = victim.question!.questionId;
    const other = state.items[1];
    withdrawQuestion(mod, victimQ, "Contains prohibited material");
    const after = getSessionState(id, user);
    expect(after.items[0].status).toBe("unavailable");
    expect(after.items[0].question).toBeNull();
    expect(() => answerQuestion(id, user, { sessionQuestionId: victim.id, optionId: victim.question!.options[0].id })).toThrow(/no longer available/);
    answerQuestion(id, user, { sessionQuestionId: other.id, optionId: other.question!.options[0].id });
    const res = finishSession(id, user);
    expect(res.unavailable).toBe(1);
    expect(res.total).toBe(3);
    expect(() => getPublicQuestion(victimQ)).toThrow();
    expect(() => addBookmark(user, victimQ)).toThrow();
    // no new session can include it
    for (let i = 0; i < 10; i++) {
      const s = createSession(null, { courseId: ctx.demo101.courseId, count: 50, mode: "practice", includeUnverified: true });
      expect(getSessionState(s.id, null).items.some((x) => x.question?.questionId === victimQ)).toBe(false);
    }
    void publishNew;
  });
});
