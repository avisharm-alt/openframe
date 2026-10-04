import { UNVERIFIED_EXPLAINER, VERIFIED_EXPLAINER } from "@/lib/copy";

const PROV: Record<string, string> = { ai_generated: "AI-generated", ai_assisted: "AI-assisted" };

const joinNames = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function QuestionMeta(p: {
  difficulty: string | null;
  aiProvenance: string | null;
  aiTool: string | null;
  reviewStatus: string;
  reviewedAt: string | null;
  verifiedBy: string[];
  isDemo?: boolean;
  topic?: string;
}) {
  const verified = p.reviewStatus === "student_reviewed";
  return (
    <div className="prov" aria-label="Question details">
      {p.isDemo && <span className="badge demo">Demo</span>}
      {verified ? (
        <>
          <span className="badge ok">✓ Verified</span>
          <span>
            {p.verifiedBy.length > 0 ? `Verified by ${joinNames(p.verifiedBy)}` : "Verified by two reviewers"}
            {p.reviewedAt ? ` on ${p.reviewedAt.slice(0, 10)}` : ""}
          </span>
        </>
      ) : (
        <span className="badge">Unverified{p.aiProvenance === "ai_generated" ? " (AI-generated)" : ""}</span>
      )}
      <span>{p.aiProvenance ? PROV[p.aiProvenance] : "Provenance not stated"}{p.aiTool ? ` (${p.aiTool})` : ""}</span>
      {p.difficulty && <span>Suggested difficulty: {p.difficulty} <span className="muted">(contributor-assigned, not validated)</span></span>}
      {p.topic && <span>Topic: {p.topic}</span>}
      <details style={{ flexBasis: "100%" }}>
        <summary className="small">What does this status mean?</summary>
        <p className="small">{verified ? VERIFIED_EXPLAINER : UNVERIFIED_EXPLAINER}</p>
      </details>
    </div>
  );
}
