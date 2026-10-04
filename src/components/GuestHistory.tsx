"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { clearHistory, readHistory, type GuestEntry } from "@/lib/guest-history";

export function GuestHistory() {
  const [list, setList] = useState<GuestEntry[] | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage, which only exists in the browser
  useEffect(() => { setList(readHistory()); }, []);
  if (list === null) return <p role="status">Loading…</p>;
  return (
    <>
      <h2>Practice history on this device</h2>
      {list.length === 0 ? (
        <p className="muted">Nothing here yet. <Link href="/">Find a course</Link> to start practising.</p>
      ) : (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrollable)">
            <table>
              <thead><tr><th scope="col">Date</th><th scope="col">Course</th><th scope="col">Mode</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>{s.courseCode}</td>
                    <td>{s.mode === "self_test" ? "Self-test" : "Practice"}</td>
                    <td>{s.finished ? `${s.correct} / ${s.total}` : "In progress"}</td>
                    <td><Link href={`/practice/${s.id}`}>{s.finished ? "Review" : "Resume"}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <button
              className="btn secondary"
              onClick={async () => {
                if (!window.confirm("Remove all practice history from this device? This cannot be undone.")) return;
                await Promise.all(readHistory().map((e) => api("DELETE", `/api/sessions/${e.id}`).catch(() => null)));
                clearHistory();
                setList([]);
              }}
            >
              Clear history on this device
            </button>
          </p>
        </>
      )}
    </>
  );
}

export function StartBookmarks() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn"
        onClick={async () => {
          try {
            const s = await api<{ id: string }>("POST", "/api/sessions", { fromBookmarks: true, count: 20, mode: "practice" });
            router.push(`/practice/${s.id}`);
          } catch (e) { setErr((e as Error).message); }
        }}
      >
        Practise bookmarked questions
      </button>
      {err && <p role="alert" className="field-error">{err}</p>}
    </>
  );
}
