import Link from "next/link";
import { currentActor } from "@/lib/session";
import { listMine } from "@/lib/services/contributions";

export const metadata = { title: "Contribute" };

const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  published: "Published",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export default async function Contribute() {
  const actor = await currentActor();
  return (
    <>
      <h1>Contribute a question</h1>
      <p>
        Questions must be <b>original</b> practice content with an answer and explanations you have checked. They are reviewed by another student before they are
        published. Read the <Link href="/guidelines">contribution guidelines</Link> and <Link href="/academic-integrity">academic integrity rules</Link> first.
        Never submit questions from real exams, quizzes or tests, and never upload files — the question form accepts structured text only.
      </p>
      {!actor ? (
        <div className="notice" role="note"><Link href="/auth/sign-in">Sign in</Link> to draft and submit questions.</div>
      ) : (
        <>
          <p className="row"><Link className="btn" href="/contribute/new">Write a new question</Link><Link className="btn secondary" href="/contribute/notes">Share your notes</Link></p>
          <p className="small muted">Prefer to share notes instead? They stay private, are never published, and volunteers may use them to write questions.</p>
          <h2>Your contributions</h2>
          <Mine actorId={actor.id} />
        </>
      )}
    </>
  );

  function Mine({ actorId }: { actorId: string }) {
    const items = listMine({ id: actorId, role: actor!.role });
    if (!items.length) return <p className="muted">Nothing yet.</p>;
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)">
        <table>
          <thead><tr><th scope="col">Question</th><th scope="col">Course / topic</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id}>
                <td>{q.stem ? (q.stem.length > 90 ? q.stem.slice(0, 90) + "…" : q.stem) : <i>(untitled draft)</i>}</td>
                <td>{q.courseCode} · {q.topic}</td>
                <td>
                  <span className="badge">{STATE_LABEL[q.state] ?? q.state}</span>
                  {q.hasLive && q.revisionState !== "approved" && <span className="badge">Revision {q.revisionNumber}: {q.revisionState.replace("_", " ")}</span>}
                  {q.requestedChanges && q.revisionState === "changes_requested" && <p className="small">Requested changes: {q.requestedChanges}</p>}
                </td>
                <td><Link href={`/contribute/${q.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
