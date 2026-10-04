export type Role = "student" | "reviewer" | "maintainer";
export type Actor = { id: string; role: Role; name?: string };

export const isReviewer = (a: Actor | null | undefined): a is Actor => !!a && (a.role === "reviewer" || a.role === "maintainer");
export const isMaintainer = (a: Actor | null | undefined): a is Actor => !!a && a.role === "maintainer";

export const DIFFICULTIES = ["introductory", "intermediate", "challenging"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const PROVENANCE = ["ai_generated", "ai_assisted"] as const;
export const REPORT_CATEGORIES = ["incorrect", "ambiguous", "irrelevant", "prohibited", "removal_request", "other"] as const;
/** Independent approvals (from different reviewers, neither the author) before a question counts as verified. */
export const REQUIRED_APPROVALS = 2;
export const REVIEW_CHECKLIST = [
  "independent_answer",
  "attestation",
  "mapping",
  "one_answer",
  "explanations",
  "distractors",
  "not_assessment",
  "references",
] as const;
export const CHECKLIST_LABELS: Record<(typeof REVIEW_CHECKLIST)[number], string> = {
  independent_answer: "I independently worked out the correct answer before looking at the key.",
  attestation: "Originality/permission attestation is present and plausible",
  mapping: "Course and topic mapping is appropriate",
  one_answer: "There is exactly one defensible correct answer",
  explanations: "Explanations are correct and stand on their own",
  distractors: "Distractors are plausible and distinct",
  not_assessment: "Does not appear to be actual university assessment content",
  references: "No unsupported or fabricated reference claims",
};
