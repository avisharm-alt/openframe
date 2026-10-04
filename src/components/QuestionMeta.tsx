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
  return (
    <div className="prov" aria-label="Question details">
      {p.isDemo && <span className="badge demo">Demo</span>}
      <span>{p.aiProvenance ? PROV[p.aiProvenance] : "Provenance not stated"}{p.aiTool ? ` (${p.aiTool})` : ""}</span>
      {p.difficulty && <span>Suggested difficulty: {p.difficulty} <span className="muted">(contributor-assigned, not validated)</span></span>}
      {p.topic && <span>Topic: {p.topic}</span>}
    </div>
  );
}
