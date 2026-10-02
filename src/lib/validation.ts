import { z } from "zod";
import { DIFFICULTIES, PROVENANCE } from "./types";

const uuid = z.string().uuid();
const trimmed = (max: number) => z.string().trim().max(max);

export const optionDraft = z.strictObject({
  id: uuid,
  text: trimmed(500),
  explanation: trimmed(2000),
});

const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => u === "" || /^https?:\/\/[^\s]+$/i.test(u), "Reference link must start with http:// or https://");

const dateStr = z
  .string()
  .trim()
  .refine((d) => d === "" || /^\d{4}-\d{2}-\d{2}$/.test(d), "Use the format YYYY-MM-DD");

/** Draft: everything optional so contributors can save progress. No file/unknown fields allowed. */
export const draftSchema = z.strictObject({
  courseId: uuid,
  topicId: uuid,
  stem: trimmed(3000).default(""),
  learningObjective: trimmed(300).default(""),
  options: z.array(optionDraft).max(5).default([]),
  correctOptionId: uuid.nullable().optional(),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  contextTag: trimmed(80).optional().default(""),
  aiProvenance: z.enum(PROVENANCE).nullable().optional(),
  aiTool: trimmed(100).optional().default(""),
  aiGeneratedOn: dateStr.optional().default(""),
  checkDescription: trimmed(1000).default(""),
  referenceText: trimmed(500).optional().default(""),
  referenceUrl: safeUrl.optional().default(""),
  publicAttribution: z.boolean().optional().default(false),
});
export type DraftInput = z.infer<typeof draftSchema>;

const POSITION_REF = /\b(option|choice|answer|statement)s?\s+\(?[a-e1-5]\)?(?![a-z0-9])|\b(both|neither)\s+\(?[a-e]\)?\s+(and|nor)\b/i;
const ALL_NONE = /\b(all|none)\s+of\s+(the\s+)?(above|below|these)\b|\bboth\s+of\s+the\s+above\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type CheckIssue = { field: string; message: string };

/**
 * Structural validation for submission. This checks form and rules only; it NEVER establishes
 * that a question is factually correct. Returns blocking `errors` and non-blocking `warnings`.
 */
export function structuralCheck(d: DraftInput): { errors: CheckIssue[]; warnings: CheckIssue[] } {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  const e = (field: string, message: string) => errors.push({ field, message });
  const w = (field: string, message: string) => warnings.push({ field, message });

  if (d.stem.length < 20) e("stem", "Write a question stem of at least 20 characters.");
  if (d.learningObjective.length < 10) e("learningObjective", "State a specific learning objective (at least 10 characters).");
  if (d.options.length < 4 || d.options.length > 5) e("options", "Provide four or five answer options.");
  const seen = new Set<string>();
  d.options.forEach((o, i) => {
    const key = `options.${i}`;
    if (!o.text) e(`${key}.text`, `Option ${i + 1} needs text.`);
    if (o.explanation.length < 10) e(`${key}.explanation`, `Option ${i + 1} needs an explanation (at least 10 characters).`);
    const n = norm(o.text);
    if (n && seen.has(n)) e(`${key}.text`, `Option ${i + 1} duplicates another option.`);
    seen.add(n);
    if (ALL_NONE.test(o.text)) e(`${key}.text`, `Option ${i + 1}: avoid "all/none of the above" style options.`);
    if (POSITION_REF.test(o.text)) e(`${key}.text`, `Option ${i + 1} refers to other options or their position; options may be shuffled.`);
  });
  if (new Set(d.options.map((o) => o.id)).size !== d.options.length) e("options", "Option ids must be unique.");
  if (POSITION_REF.test(d.stem)) {
    w("stem", "The stem seems to refer to option letters; options are shuffled, so meaning must not depend on position.");
  }
  if (!d.correctOptionId || !d.options.some((o) => o.id === d.correctOptionId)) {
    e("correctOptionId", "Mark exactly one option as the correct answer.");
  }
  if (!d.difficulty) e("difficulty", "Choose a suggested difficulty.");
  if (!d.aiProvenance) e("aiProvenance", "State whether the question was AI-generated or AI-assisted.");
  if (d.checkDescription.length < 10) e("checkDescription", "Briefly describe how you checked the answer.");
  if (d.referenceUrl && !d.referenceText) w("referenceText", "Add a title or citation for the reference link.");

  // Non-blocking hints.
  const lens = d.options.map((o) => o.text.length);
  const correct = d.options.find((o) => o.id === d.correctOptionId);
  if (correct && lens.length >= 4) {
    const others = d.options.filter((o) => o !== correct).map((o) => o.text.length);
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    if (correct.text.length > avg * 1.6 && correct.text.length > 40) {
      w("options", "The correct answer is noticeably longer than the distractors, which can cue test-takers.");
    }
  }
  if (/\b(not|except|never)\b/i.test(d.stem)) w("stem", "Negative wording in the stem can be confusing; consider rephrasing.");
  return { errors, warnings };
}

/** Keyword flags for reviewers. Heuristic only: they do not guarantee detection of prohibited content. */
export function contentFlags(d: DraftInput): string[] {
  const text = [d.stem, d.learningObjective, d.contextTag, d.referenceText, ...d.options.map((o) => o.text)].join("\n").toLowerCase();
  const flags: string[] = [];
  if (/\b(midterm|mid-term|final exam|past exam|exam question|quiz \d|test \d|question \d+\s*[:.)]|assignment \d)\b/.test(text)) {
    flags.push("assessment_keywords");
  }
  if (/\b(prof(essor)?\.?\s+[a-z]+|dr\.\s+[a-z]+|instructor|lecturer)\b/.test(text)) flags.push("instructor_mention");
  return flags;
}

const shingles = (s: string) => {
  const w = norm(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(" "));
  return out;
};
export function similarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export const submitSchema = z.strictObject({ attested: z.literal(true, { error: "You must accept the originality and permission statement." }) });

export const reviewSchema = z.strictObject({
  decision: z.enum(["approve", "request_changes", "reject"]),
  checklist: z.record(z.string(), z.boolean()).default({}),
  publicNote: trimmed(1500).optional().default(""),
  privateNote: trimmed(1500).optional().default(""),
});

export const reportSchema = z.strictObject({
  questionId: uuid.optional(),
  category: z.enum(["incorrect", "ambiguous", "irrelevant", "prohibited", "removal_request", "other"]),
  details: trimmed(2000).default(""),
});

export const courseRequestSchema = z.strictObject({
  universitySlug: z.string().trim().min(1).max(80).optional(),
  code: z.string().trim().min(2).max(30),
  title: trimmed(120).optional().default(""),
  note: trimmed(1000).optional().default(""),
});

export const sessionCreateSchema = z.strictObject({
  courseId: uuid.optional(),
  topicIds: z.array(uuid).max(100).optional(),
  count: z.number().int().min(1).max(50).default(10),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  mode: z.enum(["practice", "self_test"]).default("practice"),
  includeUnreviewed: z.boolean().default(false),
  timerMinutes: z.number().int().min(1).max(240).nullable().optional(),
  retryFrom: uuid.optional(),
  fromBookmarks: z.boolean().optional(),
});

export const answerSchema = z.strictObject({
  sessionQuestionId: uuid,
  optionId: uuid.optional(),
  skip: z.boolean().optional(),
});
