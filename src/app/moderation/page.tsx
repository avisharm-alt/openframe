import Link from "next/link";
import { currentActor } from "@/lib/session";
import { isMaintainer, isReviewer } from "@/lib/types";
import { listCourseRequests, listEvents, queue } from "@/lib/services/moderation";
import { ReportsPanel } from "@/components/ModerationPanels";

export const metadata = { title: "Moderation" };

export default async function Moderation({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to continue.</div>;
  if (!isReviewer(actor)) {
    return <div className="notice bad" role="alert"><b>Permission denied.</b> The moderation area is only for reviewers and maintainers. Roles are granted by a maintainer.</div>;
  }
  const tab = (await searchParams).tab ?? "submissions";
  const tabs = [["submissions", "Submissions"], ["reports", "Reports"], ["requests", "Course requests"], ...(isMaintainer(actor) ? [["events", "Audit log"]] : [])];
  return (
    <>
      <h1>Moderation</h1>
      <p className="muted small">You are signed in as {actor.role}. You cannot review your own submissions; another reviewer must.</p>
      <nav className="tabs" aria-label="Moderation sections">
        {tabs.map(([k, l]) => <Link key={k} href={`/moderation?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      {tab === "submissions" && <Submissions actorId={actor.id} role={actor.role} />}
      {tab === "reports" && <ReportsPanel />}
      {tab === "requests" && <Requests />}
      {tab === "events" && isMaintainer(actor) && <Events />}
    </>
  );

  function Submissions({ actorId, role }: { actorId: string; role: typeof actor extends infer A ? (A extends { role: infer R } ? R : never) : never }) {
    const items = queue({ id: actorId, role });
    if (!items.length) return <p className="muted">The review queue is empty.</p>;
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)">
        <table>
          <thead><tr><th scope="col">Submitted</th><th scope="col">Question</th><th scope="col">Course / topic</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Review</span></th></tr></thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.revisionId}>
                <td className="nowrap">{new Date(q.submittedAt).toLocaleDateString("en-CA")}</td>
                <td>{q.stem.length > 100 ? q.stem.slice(0, 100) + "…" : q.stem}</td>
                <td>{q.courseCode} · {q.topic}</td>
                <td>
                  {q.isDemo && <span className="badge demo">demo</span>}
                  {q.isEdit && <span className="badge">edit (rev {q.number})</span>}
                  {q.ownSubmission && <span className="badge">yours: needs another reviewer</span>}
                  {q.flags.length > 0 && <span className="badge demo">{q.flags.length} flag{q.flags.length === 1 ? "" : "s"}</span>}
                </td>
                <td><Link href={`/moderation/revisions/${q.revisionId}`}>{q.ownSubmission ? "View" : "Review"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  function Requests() {
    const rows = listCourseRequests(actor!) as { id: string; code: string; title: string; note: string; createdAt: string }[];
    if (!rows.length) return <p className="muted">No course requests.</p>;
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)"><table><thead><tr><th scope="col">Date</th><th scope="col">Code</th><th scope="col">Title</th><th scope="col">Note</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="nowrap">{r.createdAt.slice(0, 10)}</td><td>{r.code}</td><td>{r.title}</td><td>{r.note}</td></tr>)}</tbody></table></div>
    );
  }
  function Events() {
    const rows = listEvents(actor!) as { id: string; action: string; questionId: string | null; detail: string; createdAt: string; actorName: string | null }[];
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)"><table><thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Question</th><th scope="col">Detail</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="nowrap">{r.createdAt.replace("T", " ").slice(0, 16)}</td><td>{r.actorName ?? "system"}</td><td>{r.action}</td><td className="small">{r.questionId?.slice(0, 8)}</td><td className="small">{r.detail === "{}" ? "" : r.detail}</td></tr>)}</tbody></table></div>
    );
  }
}
