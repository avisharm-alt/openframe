"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Report = { id: string; category: string; details: string; priority: number; state: string; createdAt: string; questionId: string | null; questionState: string | null; stem: string | null; courseCode: string | null };

export function ReportsPanel() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("active");
  const load = useCallback(async () => {
    try {
      const r = await api<{ reports: Report[] }>("GET", `/api/moderation/reports${filter === "active" ? "" : `?state=${filter}`}`);
      setReports(r.reports);
    } catch (e) { setError((e as Error).message); }
  }, [filter]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { load(); }, [load]);

  async function setState(id: string, state: string) {
    const note = state === "resolved" || state === "dismissed" ? window.prompt("Short resolution note (optional):") ?? undefined : undefined;
    try { await api("PATCH", `/api/moderation/reports/${id}`, { state, note }); load(); } catch (e) { setError((e as Error).message); }
  }
  async function withdraw(r: Report) {
    const reason = window.prompt("Reason for withdrawing this question (logged in the audit trail):");
    if (!reason || !r.questionId) return;
    try { await api("POST", `/api/moderation/questions/${r.questionId}/withdraw`, { reason, reportId: r.id }); load(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <div>
      <label htmlFor="rf" className="sr-only">Report filter</label>
      <select id="rf" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: "14rem" }}>
        <option value="active">Open &amp; investigating</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
      </select>
      {error && <p role="alert" className="field-error">{error}</p>}
      {reports === null ? <p role="status">Loading…</p> : reports.length === 0 ? <p className="muted">No reports here.</p> : (
        reports.map((r) => (
          <article key={r.id} className="card" aria-label={`Report ${r.category}`}>
            <p style={{ margin: 0 }}>
              {r.priority > 0 && <span className="badge demo">Priority</span>}<span className="badge">{r.category.replace("_", " ")}</span><span className="badge">{r.state}</span>
              {r.questionState && r.questionState !== "published" && <span className="badge">question {r.questionState}</span>}
              <span className="small muted"> {r.createdAt.slice(0, 10)} {r.courseCode}</span>
            </p>
            {r.stem && <p className="small">{r.stem.length > 160 ? r.stem.slice(0, 160) + "…" : r.stem}</p>}
            {r.details && <p>“{r.details}”</p>}
            <div className="row">
              <button className="btn small secondary" onClick={() => setState(r.id, "investigating")}>Investigating</button>
              <button className="btn small secondary" onClick={() => setState(r.id, "resolved")}>Resolve</button>
              <button className="btn small secondary" onClick={() => setState(r.id, "dismissed")}>Dismiss</button>
              {r.questionId && r.questionState === "published" && <button className="btn small danger" onClick={() => withdraw(r)}>Withdraw question</button>}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
