import Link from "next/link";
import { currentActor } from "@/lib/session";
import { listBookmarks } from "@/lib/services/bookmarks";
import { listSessions } from "@/lib/services/practice";
import { GuestHistory } from "@/components/GuestHistory";
import { StartBookmarks } from "@/components/GuestHistory";

export const metadata = { title: "Saved & history" };

export default async function Saved() {
  const actor = await currentActor();
  if (!actor) {
    return (
      <>
        <h1>Saved &amp; history</h1>
        <div className="notice" role="note">
          You are browsing as a guest. Practice history is stored in this browser only and is specific to this device.
          <Link href="/auth/sign-in"> Sign in</Link> to save history across devices and to bookmark questions.
        </div>
        <GuestHistory />
      </>
    );
  }
  const bookmarks = listBookmarks(actor);
  const sessions = listSessions(actor);
  return (
    <>
      <h1>Saved &amp; history</h1>
      <p className="muted">Only you can see this page. Your history is private.</p>
      <h2>Bookmarked questions</h2>
      {bookmarks.length === 0 ? (
        <p className="muted">No bookmarks yet. Use “Bookmark” while practising. Withdrawn questions disappear from this list automatically.</p>
      ) : (
        <>
          <StartBookmarks />
          <ul>
            {bookmarks.map((b) => (
              <li key={b.id}><span className="badge">{b.courseCode}</span>{b.reviewStatus === "student_reviewed" ? <span className="badge ok">✓ Verified</span> : <span className="badge">Unverified</span>}{b.topic}: {b.stem.length > 140 ? b.stem.slice(0, 140) + "…" : b.stem}</li>
            ))}
          </ul>
        </>
      )}
      <h2>Practice history</h2>
      {sessions.length === 0 ? (
        <p className="muted">No sessions yet. <Link href="/">Find a course</Link> to start.</p>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)">
          <table>
            <thead><tr><th scope="col">Date</th><th scope="col">Course</th><th scope="col">Mode</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{s.courseCode ?? "—"}</td>
                  <td>{s.mode === "self_test" ? "Self-test" : "Practice"}</td>
                  <td>{s.state === "finished" && s.results ? `${s.results.correct} / ${s.results.total}` : s.state === "in_progress" ? "In progress" : "Abandoned"}</td>
                  <td>{s.state !== "abandoned" && <Link href={`/practice/${s.id}`}>{s.state === "in_progress" ? "Resume" : "Review"}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
