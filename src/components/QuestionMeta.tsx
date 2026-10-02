import { STUDENT_REVIEWED_EXPLAINER } from "@/lib/copy";

const PROV: Record<string, string> = { ai_generated: "AI-generated", ai_assisted: "AI-assisted" };

export function QuestionMeta(p: {
  difficulty: string | null;
  aiProvenance: string | null;
  aiTool?: string | null;
  reviewStatus: string;
  reviewedAt: string | null;
  isDemo?: boolean;
  topic?: string;
}) {
  const reviewed = p.reviewStatus === "student_reviewed";
  return (
    <div className="prov" aria-label="Question details">
      {p.isDemo && <span className="badge demo">Demo</span>}
      {reviewed ? <span className="badge ok">✓ Student-reviewed</span> : <span className="badge">Unreviewed</span>}
      {p.reviewedAt && <span>Last reviewed {new Date(p.reviewedAt).toLocaleDateString("en-CA")}</span>}
      <span>{p.aiProvenance ? PROV[p.aiProvenance] : "Provenance not stated"}{p.aiTool ? ` (${p.aiTool})` : ""}</span>
      {p.difficulty && <span>Suggested difficulty: {p.difficulty} <span className="muted">(contributor-assigned, not validated)</span></span>}
      {p.topic && <span>Topic: {p.topic}</span>}
      <details style={{ flexBasis: "100%" }}>
        <summary className="small">What does this status mean?</summary>
        <p className="small">{reviewed ? STUDENT_REVIEWED_EXPLAINER : "Unreviewed: no one has checked this question yet. Treat it with extra caution."}</p>
      </details>
    </div>
  );
}
