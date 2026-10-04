import { openDb, migrate, setDb, uid, now, type DB } from "@/lib/db";
import { seedDemoContent } from "@/lib/seed";
import { SEED_COURSES } from "@/lib/seed-data";
import { createDraft, submit } from "@/lib/services/contributions";
import { reviewRevision } from "@/lib/services/moderation";
import type { Actor, Role } from "@/lib/types";
import { REVIEW_CHECKLIST } from "@/lib/types";

export function freshDb(): DB {
  const db = openDb(":memory:");
  migrate(db);
  setDb(db);
  return db;
}

export function makeUser(db: DB, name: string, role: Role = "student"): Actor {
  const id = uid();
  db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?,?,?,?,?,?,?)').run(
    id, name, `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`, 0, now(), now(), role,
  );
  return { id, role, name };
}

export const ALL_CHECKS = Object.fromEntries(REVIEW_CHECKLIST.map((k) => [k, true]));

/** Seeds demo content and returns lookups. All seeded questions are published + unreviewed. */
export function seeded(db: DB) {
  const rows = seedDemoContent(db);
  const demo101 = rows.find((r) => r.slug === "demo-101")!;
  return { rows, demo101 };
}

export function validDraft(courseId: string, topicId: string, overrides: Record<string, unknown> = {}) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  return {
    courseId,
    topicId,
    stem: "Which structure lets a program repeat steps while a condition stays true?",
    learningObjective: "Select an appropriate looping construct for a described task.",
    options: [
      { id: ids[0], text: "A while loop", explanation: "A while loop repeats while its condition holds." },
      { id: ids[1], text: "A comment line", explanation: "Comments are ignored by the interpreter." },
      { id: ids[2], text: "An import statement", explanation: "Imports load modules and do not repeat code." },
      { id: ids[3], text: "A string literal", explanation: "A string literal is a value, not control flow." },
    ],
    correctOptionId: ids[0],
    difficulty: "introductory",
    aiProvenance: "ai_assisted",
    checkDescription: "Checked against the language documentation for loops.",
    ...overrides,
  };
}

export const approve = (reviewer: Actor, revisionId: string) =>
  reviewRevision(reviewer, revisionId, { decision: "approve", checklist: ALL_CHECKS, publicNote: "", privateNote: "ok" });

/** Contribution -> submit -> two independent approvals -> published and verified. `reviewer` is the first approver. */
export function publishNew(db: DB, author: Actor, reviewer: Actor, courseId: string, topicId: string, overrides: Record<string, unknown> = {}) {
  const { id, revisionId } = createDraft(author, validDraft(courseId, topicId, overrides));
  submit(author, id, true);
  approve(reviewer, revisionId);
  approve(makeUser(db, `Second ${uid().slice(0, 8)}`, "reviewer"), revisionId);
  return { questionId: id, revisionId };
}

export { SEED_COURSES };
