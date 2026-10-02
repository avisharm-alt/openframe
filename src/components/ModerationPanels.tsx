"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { CHECKLIST_LABELS, REVIEW_CHECKLIST } from "@/lib/types";
import { STRUCTURAL_CHECK_NOTE, STUDENT_REVIEWED_EXPLAINER } from "@/lib/copy";

export function ReviewPanel({ revisionId, questionId }: { revisionId: string; questionId: string }) {
  const router = useRouter();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [publicNote, setPublicNote] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = REVIEW_CHECKLIST.every((k) => checks[k]);

  async function decide(decision: "approve" | "request_changes" | "reject") {
    setBusy(true); setError(null);
    try {
      await api("POST", `/api/moderation/revisions/${revisionId}/review`, { decision, checklist: checks, publicNote, privateNote });
      router.push("/moderation");
      router.refresh();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function withdraw() {
    const reason = window.prompt("Reason for withdrawing this question (logged in the audit trail):");
    if (!reason) return;
    try { await api("POST", `/api/moderation/questions/${questionId}/withdraw`, { reason }); router.push("/moderation"); router.refresh(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <form className="card" onSubmit={(e) => e.preventDefault()} aria-label="Review decision">
      <h2 style={{ marginTop: 0 }}>Your review</h2>
      <p className="small muted">{STUDENT_REVIEWED_EXPLAINER} {STRUCTURAL_CHECK_NOTE}</p>
      <fieldset>
        <legend>Checklist (all required to approve)</legend>
        {REVIEW_CHECKLIST.map((k) => (
          <label key={k} className="check"><input type="checkbox" checked={!!checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} /><span>{CHECKLIST_LABELS[k]}</span></label>
        ))}
      </fieldset>
      <label htmlFor="pub">Note to the contributor <span className="help">Required when requesting changes or rejecting. Visible to the contributor.</span></label>
      <textarea id="pub" value={publicNote} maxLength={1500} onChange={(e) => setPublicNote(e.target.value)} />
      <label htmlFor="priv">Private note <span className="help">Visible to reviewers only.</span></label>
      <textarea id="priv" style={{ minHeight: "4rem" }} value={privateNote} maxLength={1500} onChange={(e) => setPrivateNote(e.target.value)} />
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" disabled={!all || busy} onClick={() => decide("approve")}>Approve &amp; publish as student-reviewed</button>
        <button className="btn secondary" disabled={busy || !publicNote.trim()} onClick={() => decide("request_changes")}>Request changes</button>
        <button className="btn danger" disabled={busy || !publicNote.trim()} onClick={() => decide("reject")}>Reject</button>
        <button className="btn secondary" type="button" onClick={withdraw}>Withdraw question…</button>
      </div>
    </form>
  );
}

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
