import Link from "next/link";
import { currentActor } from "@/lib/session";
import { isMaintainer, isReviewer } from "@/lib/types";
import { listCourseRequests, listEvents, queue, verificationProgress, verificationQueue } from "@/lib/services/moderation";
import { listCourseNotes } from "@/lib/services/course-notes";
import { ReportsPanel } from "@/components/ModerationPanels";

export const metadata = { title: "Moderation" };

const PAGE_SIZE = 50;

export default async function Moderation({ searchParams }: { searchParams: Promise<{ tab?: string; course?: string; page?: string }> }) {
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to continue.</div>;
  if (!isReviewer(actor)) {
    return <div className="notice bad" role="alert"><b>Permission denied.</b> The moderation area is only for reviewers and maintainers. Roles are granted by a maintainer.</div>;
  }
  const sp = await searchParams;
  const tab = sp.tab ?? "submissions";
  const progress = verificationProgress(actor);
  const tabs = [["submissions", "Submissions"], ["verify", `Needs verification (${progress.total - progress.verified})`], ["reports", "Reports"], ["notes", "Course notes"], ["requests", "Course requests"], ...(isMaintainer(actor) ? [["events", "Audit log"]] : [])];
  return (
    <>
      <h1>Moderation</h1>
      <p className="muted small">You are signed in as {actor.role}. You cannot review your own submissions; another reviewer must. Questions are verified, and new submissions published, only after approvals from two different reviewers. Your display name is shown publicly on questions you help verify.</p>
      <nav className="tabs" aria-label="Moderation sections">
        {tabs.map(([k, l]) => <Link key={k} href={`/moderation?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      {tab === "submissions" && <Submissions actorId={actor.id} role={actor.role} />}
      {tab === "verify" && <Verify />}
      {tab === "reports" && <ReportsPanel />}
      {tab === "notes" && <Notes />}
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
          <thead><tr><th scope="col">Submitted</th><th scope="col">Question</th><th scope="col">Course / topic</th><th scope="col">Approvals</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Review</span></th></tr></thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.revisionId}>
                <td>{new Date(q.submittedAt).toLocaleDateString("en-CA")}</td>
                <td>{q.stem.length > 100 ? q.stem.slice(0, 100) + "…" : q.stem}</td>
                <td>{q.courseCode} · {q.topic}</td>
                <td>{q.approvals} of {q.required}</td>
                <td>
                  {q.isDemo && <span className="badge demo">demo</span>}
                  {q.isEdit && <span className="badge">edit (rev {q.number})</span>}
                  {q.ownSubmission && <span className="badge">yours: needs other reviewers</span>}
                  {q.approvedByMe && <span className="badge">you approved</span>}
                  {q.flags.length > 0 && <span className="badge demo">{q.flags.length} flag{q.flags.length === 1 ? "" : "s"}</span>}
                </td>
                <td><Link href={`/moderation/revisions/${q.revisionId}?list=submissions`}>{q.ownSubmission || q.approvedByMe ? "View" : "Review"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  function Verify() {
    const all = verificationQueue(actor!);
    const courses = [...new Map(all.map((i) => [i.courseId, i.courseCode])).entries()];
    const items = sp.course ? all.filter((i) => i.courseId === sp.course) : all;
    const page = Math.max(1, Number(sp.page) || 1);
    const rows = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const first = items.find((i) => !i.wroteIt && !i.decidedByMe);
    const href = (extra: Record<string, string>) => `/moderation?${new URLSearchParams({ tab: "verify", ...(sp.course ? { course: sp.course } : {}), ...extra })}`;
    return (
      <>
        <p>
          <b>{progress.verified}</b> of <b>{progress.total}</b> published questions are verified. Each needs approvals from two different reviewers who worked out the answer
          themselves. Questions that already have one approval come first.
        </p>
        <nav aria-label="Filter by course" className="row" style={{ margin: "0.5rem 0" }}>
          <Link href="/moderation?tab=verify" aria-current={!sp.course ? "page" : undefined} className="btn small secondary">All courses ({all.length})</Link>
          {courses.map(([id, code]) => <Link key={id} href={`/moderation?tab=verify&course=${id}`} aria-current={sp.course === id ? "page" : undefined} className="btn small secondary">{code} ({all.filter((i) => i.courseId === id).length})</Link>)}
        </nav>
        {first ? (
          <p><Link className="btn" href={`/moderation/revisions/${first.revisionId}?list=verify`}>Start reviewing ({items.filter((i) => !i.wroteIt && !i.decidedByMe).length} for you)</Link>
            <span className="small muted"> Use the keyboard shortcuts on the review page to work through the queue quickly.</span></p>
        ) : <p className="muted">Nothing left for you to verify here.</p>}
        {rows.length > 0 && (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)">
            <table>
              <thead><tr><th scope="col">Question</th><th scope="col">Course / topic</th><th scope="col">Approvals</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Review</span></th></tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.revisionId}>
                    <td>{q.stem.length > 100 ? q.stem.slice(0, 100) + "…" : q.stem}</td>
                    <td>{q.courseCode} · {q.topic}</td>
                    <td>{q.approvals} of {q.required}</td>
                    <td>
                      {q.isDemo && <span className="badge demo">demo</span>}
                      {q.objected && <span className="badge demo">changes requested</span>}
                      {q.decidedByMe && <span className="badge">you decided</span>}
                      {q.wroteIt && <span className="badge">yours: needs other reviewers</span>}
                    </td>
                    <td><Link href={`/moderation/revisions/${q.revisionId}?list=verify`}>{q.wroteIt || q.decidedByMe ? "View" : "Review"}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="row" style={{ marginTop: "0.8rem" }}>
            {page > 1 && <Link href={href({ page: String(page - 1) })}>← Previous page</Link>}
            <span className="small muted">Page {page} of {pages}</span>
            {page < pages && <Link href={href({ page: String(page + 1) })}>Next page →</Link>}
          </nav>
        )}
      </>
    );
  }
  function Notes() {
    const notes = listCourseNotes(actor!, true);
    if (!notes.length) return <p className="muted">No course notes uploaded yet.</p>;
    return <ul>{notes.map((n) => <li key={n.id}><a href={"/api/course-notes/" + n.id}>{n.filename}</a> · {n.courseCode} · {n.createdAt.slice(0, 10)}</li>)}</ul>;
  }
  function Requests() {
    const rows = listCourseRequests(actor!) as { id: string; code: string; title: string; note: string; universityName: string | null; createdAt: string }[];
    if (!rows.length) return <p className="muted">No course requests.</p>;
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)"><table><thead><tr><th scope="col">Date</th><th scope="col">University</th><th scope="col">Code</th><th scope="col">Title</th><th scope="col">Note</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.createdAt.slice(0, 10)}</td><td>{r.universityName ?? "Not specified"}</td><td>{r.code}</td><td>{r.title}</td><td>{r.note}</td></tr>)}</tbody></table></div>
    );
  }
  function Events() {
    const rows = listEvents(actor!) as { id: string; action: string; questionId: string | null; detail: string; createdAt: string; actorName: string | null }[];
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)"><table><thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Question</th><th scope="col">Detail</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.createdAt.replace("T", " ").slice(0, 16)}</td><td>{r.actorName ?? "system"}</td><td>{r.action}</td><td className="small">{r.questionId?.slice(0, 8)}</td><td className="small">{r.detail === "{}" ? "" : r.detail}</td></tr>)}</tbody></table></div>
    );
  }
}
