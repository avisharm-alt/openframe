import Link from "next/link";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/session";
import { isReviewer } from "@/lib/types";
import { getRevisionForReview } from "@/lib/services/moderation";
import { ServiceError } from "@/lib/errors";
import { Markdown } from "@/components/Markdown";
import { ReviewPanel } from "@/components/ModerationPanels";

export const metadata = { title: "Review submission" };

type Rev = Record<string, string | null | number | unknown[]>;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to continue.</div>;
  if (!isReviewer(actor)) return <div className="notice bad" role="alert"><b>Permission denied.</b> Reviewer access required.</div>;
  let d;
  try {
    d = getRevisionForReview(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const r = d.revision as Rev;
  const options = d.options as { id: string; text: string; explanation: string }[];
  const flags = r.flags as { code: string; questionId?: string; similarity?: number }[];
  return (
    <>
      <p className="small"><Link href="/moderation">← Queue</Link></p>
      <h1>Review: {String(r.courseCode)} · {String(r.topicTitle)}</h1>
      <p className="muted small">Revision {String(r.number)} · state: {String(r.state)} · author: {String(r.authorName ?? "unknown")}</p>
      {!d.canReview && <div className="notice warn" role="alert">You authored this submission. Another reviewer must review it.</div>}
      {flags.length > 0 && (
        <div className="notice warn" role="note">
          <b>Automatic flags</b> (heuristics only — they cannot guarantee detection of prohibited content):
          <ul>{flags.map((f, i) => <li key={i}>{f.code === "assessment_keywords" ? "Text contains words typical of exams or quizzes." : f.code === "instructor_mention" ? "Text mentions an instructor." : `Possible duplicate of question ${f.questionId?.slice(0, 8)} (similarity ${f.similarity}).`}</li>)}</ul>
        </div>
      )}
      {d.liveStem && <details className="card"><summary>Currently published stem (this is an edit)</summary><Markdown>{d.liveStem}</Markdown></details>}
      <div className="card">
        <p className="small muted">Objective: {String(r.learning_objective)} · Suggested difficulty: {String(r.difficulty)} (contributor-assigned) · Provenance: {String(r.ai_provenance)}{r.ai_tool ? ` (${r.ai_tool})` : ""}{r.ai_generated_on ? ` on ${r.ai_generated_on}` : ""}</p>
        <Markdown>{String(r.stem)}</Markdown>
        <ol type="A">
          {options.map((o) => (
            <li key={o.id} style={{ margin: "0.6rem 0" }}>
              <b>{o.id === r.correct_option_id ? "✓ Correct: " : ""}</b>{o.text}
              <div className="small muted">{o.explanation}</div>
            </li>
          ))}
        </ol>
        <p className="small"><b>How the contributor checked:</b> {String(r.check_description)}</p>
        {r.reference_text && <p className="small"><b>Reference:</b> {String(r.reference_text)} {r.reference_url && <>— <span className="muted">{String(r.reference_url)} (unverified, not fetched)</span></>}</p>}
        <p className="small muted">Attested {String(r.attested_at ?? "never")}: “{String(r.attestation_text ?? "")}”</p>
      </div>
      {(d.reviews as { decision: string; publicNote: string | null; privateNote: string | null; createdAt: string; reviewerName: string | null }[]).length > 0 && (
        <>
          <h2>Review history</h2>
          {(d.reviews as { decision: string; publicNote: string | null; privateNote: string | null; createdAt: string; reviewerName: string | null }[]).map((rv, i) => (
            <div key={i} className="card small">{rv.createdAt.slice(0, 10)} · {rv.reviewerName ?? "reviewer"} · <b>{rv.decision}</b>{rv.publicNote && <p>Public note: {rv.publicNote}</p>}{rv.privateNote && <p>Private note (reviewers only): {rv.privateNote}</p>}</div>
          ))}
        </>
      )}
      {r.state === "pending" && d.canReview && <ReviewPanel revisionId={id} questionId={String(r.question_id)} />}
    </>
  );
}
