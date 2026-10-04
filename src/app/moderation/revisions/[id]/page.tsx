import Link from "next/link";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/session";
import { isReviewer } from "@/lib/types";
import { getRevisionForReview, reviewNavigation } from "@/lib/services/moderation";
import { ServiceError } from "@/lib/errors";
import { Markdown } from "@/components/Markdown";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";

export const metadata = { title: "Review submission" };

type Rev = Record<string, string | null | number | unknown[]>;

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ list?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
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
  const list = sp.list === "verify" || sp.list === "submissions" ? sp.list : d.kind === "verification" ? "verify" : "submissions";
  const nav = reviewNavigation(actor, id, list);
  const reviews = d.reviews as { decision: string; publicNote: string | null; privateNote: string | null; createdAt: string; reviewerName: string | null }[];
  return (
    <>
      <p className="small"><Link href={`/moderation?tab=${list}`}>← Queue</Link></p>
      <h1>Review: {String(r.courseCode)} · {String(r.topicTitle)}</h1>
      <p className="muted small">
        Revision {String(r.number)} · {d.kind === "verification" ? "published, unverified" : `state: ${String(r.state)}`} · author: {String(r.authorName ?? (r.ai_provenance === "ai_generated" ? "imported AI-generated question" : "unknown"))}
      </p>
      {flags.length > 0 && (
        <div className="notice warn" role="note">
          <b>Automatic flags</b> (heuristics only — they cannot guarantee detection of prohibited content):
          <ul>{flags.map((f, i) => <li key={i}>{f.code === "assessment_keywords" ? "Text contains words typical of exams or quizzes." : f.code === "instructor_mention" ? "Text mentions an instructor." : `Possible duplicate of question ${f.questionId?.slice(0, 8)} (similarity ${f.similarity}).`}</li>)}</ul>
        </div>
      )}
      {d.liveStem && d.kind === "submission" && <details className="card"><summary>Currently published stem (this is an edit)</summary><Markdown>{d.liveStem}</Markdown></details>}
      <p className="small muted">Objective: {String(r.learning_objective)} · Suggested difficulty: {String(r.difficulty)} (contributor-assigned) · Provenance: {String(r.ai_provenance)}{r.ai_tool ? ` (${r.ai_tool})` : ""}{r.ai_generated_on ? ` on ${r.ai_generated_on}` : ""}</p>
      <ReviewWorkspace
        key={id}
        revisionId={id}
        questionId={String(r.question_id)}
        kind={d.kind}
        canReview={d.canReview}
        canEdit={d.canEdit}
        wroteIt={d.wroteIt}
        alreadyApproved={d.alreadyApproved}
        approvals={d.approvals}
        required={d.required}
        approvedBy={d.approvedBy}
        objected={d.objected}
        nav={nav}
        options={options}
        correctOptionId={(r.correct_option_id as string | null) ?? null}
        stem={<Markdown>{String(r.stem)}</Markdown>}
        edit={{ stem: String(r.stem), learningObjective: String(r.learning_objective), difficulty: String(r.difficulty ?? "") }}
      />
      <div className="card small" style={{ marginTop: "0.8rem" }}>
        <p><b>How the question was checked (by its author or generator, not independent):</b> {String(r.check_description)}</p>
        {r.reference_text && <p><b>Reference:</b> {String(r.reference_text)} {r.reference_url && <>— <span className="muted">{String(r.reference_url)} (unverified, not fetched)</span></>}</p>}
        <p className="muted" style={{ marginBottom: 0 }}>Attested {String(r.attested_at ?? "never")}: “{String(r.attestation_text ?? "")}”</p>
      </div>
      {reviews.length > 0 && (
        <>
          <h2>Review history</h2>
          {reviews.map((rv, i) => (
            <div key={i} className="card small">{rv.createdAt.slice(0, 10)} · {rv.reviewerName ?? "reviewer"} · <b>{rv.decision}</b>{rv.publicNote && <p>Public note: {rv.publicNote}</p>}{rv.privateNote && <p>Private note (reviewers only): {rv.privateNote}</p>}</div>
          ))}
        </>
      )}
    </>
  );
}
