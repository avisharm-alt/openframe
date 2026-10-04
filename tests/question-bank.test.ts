import { describe, expect, it } from "vitest";
import biochem from "../content/western/biochem-2280a-150-questions.json";
import organic from "../content/western/chem-2213a-150-questions.json";
import { importBundledQuestionBank, importQuestionBank } from "@/lib/question-bank";
import { getCourse, getPublicQuestion } from "@/lib/services/catalog";
import { createSession, getSessionState } from "@/lib/services/practice";
import { freshDb } from "./helpers";

describe("Western question bank import", () => {
  it("publishes 150 questions per course with complete topic mapping and working practice", () => {
    const db = freshDb();
    expect(importBundledQuestionBank(db).added).toBe(300);
    expect(db.prepare("SELECT id FROM question_revision WHERE check_description LIKE '%Human review is pending%'").all()).toHaveLength(0);
    const bio = getCourse("biochem-2280a");
    const chem = getCourse("chem-2213a");
    expect(bio.verifiedCount + bio.unverifiedCount).toBe(150);
    expect(chem.verifiedCount + chem.unverifiedCount).toBe(150);
    expect(bio.units).toHaveLength(3);
    expect(bio.units.flatMap((u) => u.topics)).toHaveLength(23);
    expect(chem.units).toHaveLength(10);
    expect(chem.units.map((u) => u.title)).toEqual([...new Set(organic.map((q) => q.unit))]);
    const { id } = createSession(null, { courseId: chem.id, count: 5, mode: "practice", includeUnverified: true });
    const session = getSessionState(id, null);
    expect(session.items).toHaveLength(5);
    expect(JSON.stringify(session)).not.toContain("sourceEvidence");
    expect(JSON.stringify(session)).not.toContain("correctOptionId");
    db.close();
  });

  it("is idempotent and does not republish withdrawn questions", () => {
    const db = freshDb();
    importBundledQuestionBank(db);
    const imported = db.prepare("SELECT question_id FROM question_bank_import LIMIT 1").get() as { question_id: string };
    db.prepare("UPDATE question SET state = 'withdrawn' WHERE id = ?").run(imported.question_id);
    expect(importBundledQuestionBank(db)).toEqual({ added: 0, existing: 300, evidenceUpdated: 0 });
    expect((db.prepare("SELECT state FROM question WHERE id = ?").get(imported.question_id) as { state: string }).state).toBe("withdrawn");
    expect((db.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n).toBe(300);
    db.close();
  });

  it("retains raw source evidence privately and rejects edits to imported content", () => {
    const db = freshDb();
    importBundledQuestionBank(db);
    const sourceEvidence = [{ file: "private-notes.pdf", location: "PDF page 1", supports: "Teaching concept" }];
    expect(importQuestionBank(db, [{ ...biochem[0], sourceEvidence }]).evidenceUpdated).toBe(1);
    const record = db.prepare("SELECT question_id, source_evidence, owner_review_note FROM question_bank_import WHERE question_key = ?").get(biochem[0].questionKey) as { question_id: string; source_evidence: string; owner_review_note: string };
    expect(JSON.parse(record.source_evidence)).toEqual(sourceEvidence);
    expect(record.owner_review_note).toContain("project owner");
    const publicQuestion = getPublicQuestion(record.question_id);
    expect(JSON.stringify(publicQuestion)).not.toContain("private-notes.pdf");
    expect(publicQuestion).not.toHaveProperty("correctOptionId");
    expect(() => importQuestionBank(db, [{ ...biochem[0], stem: "An edited question stem that must not overwrite published content." }])).toThrow("imported content differs");
    expect(getPublicQuestion(record.question_id).stem).toBe(biochem[0].stem);
    expect([...biochem, ...organic].some((q) => "sourceEvidence" in q)).toBe(false);
    db.close();
  });

  it("rejects an invalid answer key before writing any rows", () => {
    const db = freshDb();
    expect(() => importQuestionBank(db, [biochem[0], { ...biochem[1], correctOptionKey: "missing" }])).toThrow();
    expect((db.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n).toBe(0);
    db.close();
  });
});
