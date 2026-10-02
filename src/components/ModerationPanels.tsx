"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { CHECKLIST_LABELS, REVIEW_CHECKLIST } from "@/lib/types";
import { STRUCTURAL_CHECK_NOTE, STUDENT_REVIEWED_EXPLAINER } from "@/lib/copy";
import { Dialog } from "./Dialog";

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

type QuestionRow = { id: string; state: string; courseCode: string; topic: string; stem: string | null; authorName: string | null; reviewStatus: string | null; updatedAt: string };

/** Maintainers only: find any question and delete it permanently (with a reason that goes to the audit log). */
export function QuestionsPanel() {
  const [rows, setRows] = useState<QuestionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState<QuestionRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await api<{ questions: QuestionRow[] }>("GET", "/api/moderation/questions")).questions); } catch (e) { setError((e as Error).message); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { load(); }, [load]);

  const shown = (rows ?? []).filter((r) => `${r.courseCode} ${r.topic} ${r.stem ?? ""} ${r.authorName ?? ""} ${r.state}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const close = () => { setTarget(null); setReason(""); };
  async function remove() {
    if (!target) return;
    setBusy(true); setError(null);
    try { await api("DELETE", `/api/moderation/questions/${target.id}`, { reason }); close(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      <label htmlFor="qf">Filter questions <span className="help">Matches course, topic, text, author or status. Showing the 300 most recently changed. Drafts are private, so their text is not shown.</span></label>
      <input id="qf" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" />
      {error && <p role="alert" className="field-error">{error}</p>}
      {rows === null ? <p role="status">Loading…</p> : shown.length === 0 ? <p className="muted">No questions match.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Questions (scrollable)">
          <table>
            <caption className="sr-only">All questions</caption>
            <thead><tr><th scope="col">Updated</th><th scope="col">Question</th><th scope="col">Course / topic</th><th scope="col">Author</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const plain = (r.stem ?? "").replace(/```[a-z]*/gi, " ").replace(/`/g, "").replace(/\s+/g, " ").trim();
                const label = r.stem ? (plain.length > 80 ? plain.slice(0, 80) + "…" : plain) : "(private draft)";
                return (
                  <tr key={r.id}>
                    <td className="nowrap">{r.updatedAt.slice(0, 10)}</td>
                    <td>{r.stem ? label : <i>{label}</i>}</td>
                    <td>{r.courseCode} · {r.topic}</td>
                    <td>{r.authorName ?? "—"}</td>
                    <td><span className="badge">{r.state.replace("_", " ")}</span>{r.reviewStatus === "student_reviewed" && <span className="badge ok">reviewed</span>}</td>
                    <td><button className="btn small danger" onClick={() => setTarget(r)} aria-label={`Delete question: ${label}`}>Delete</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={target !== null} onClose={close} title="Delete this question permanently?">
        <p>The text, options and explanations are erased and cannot be recovered. Students who already practised it will see it as no longer available. To hide it reversibly, withdraw it instead.</p>
        <label htmlFor="del-reason">Reason <span className="help">Required. Kept in the audit log; do not paste the question text.</span></label>
        <textarea id="del-reason" style={{ minHeight: "4rem" }} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        <div className="row" style={{ marginTop: "1rem" }}>
          <button className="btn danger" disabled={busy || reason.trim().length < 5} onClick={remove}>{busy ? "Deleting…" : "Delete permanently"}</button>
          <button className="btn secondary" onClick={close}>Cancel</button>
        </div>
      </Dialog>
    </div>
  );
}

type NoteRow = { id: string; title: string; courseCode: string; authorName: string | null; status: string; createdAt: string; expiresAt: string; chars: number; flags: string[]; fileCount: number };
type NoteFull = Omit<NoteRow, "fileCount"> & { text: string; courseTitle: string; consentVersion: string; consentedAt: string; files: { id: string; name: string; size: number }[] };
const FLAG_LABEL: Record<string, string> = { assessment_keywords: "Exam-like wording", instructor_mention: "Mentions an instructor" };

/**
 * Maintainers only: private notes students have shared. Opening one is recorded in the audit log. The text is shown in a
 * read-only box (never rendered as Markdown or HTML) so it can be copied into whatever tool is used to draft questions.
 */
export function NotesPanel() {
  const [rows, setRows] = useState<NoteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<NoteFull | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await api<{ notes: NoteRow[] }>("GET", "/api/moderation/notes")).notes); } catch (e) { setError((e as Error).message); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(null); setConfirmDel(false); setCopied(false); };
  async function openNote(id: string) {
    setError(null);
    try { setOpen(await api<NoteFull>("GET", `/api/moderation/notes/${id}`)); } catch (e) { setError((e as Error).message); }
  }
  async function setStatus(status: string) {
    if (!open) return;
    setBusy(true);
    try { await api("PATCH", `/api/moderation/notes/${open.id}`, { status }); setOpen({ ...open, status }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!open) return;
    setBusy(true);
    try { await api("DELETE", `/api/moderation/notes/${open.id}`); close(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function copy() {
    if (!open) return;
    try { await navigator.clipboard.writeText(open.text); setCopied(true); } catch { setError("Could not copy automatically. Select the text and copy it."); }
  }
  return (
    <div>
      <p className="small muted">Notes shared privately by students. They are never shown to anyone else and are deleted automatically after the retention period. Opening a note is recorded in the audit log.</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      {rows === null ? <p role="status">Loading…</p> : rows.length === 0 ? <p className="muted">No notes have been shared.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Notes (scrollable)">
          <table>
            <caption className="sr-only">Shared notes</caption>
            <thead><tr><th scope="col">Received</th><th scope="col">Title</th><th scope="col">Course</th><th scope="col">From</th><th scope="col">Contents</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{r.createdAt.slice(0, 10)}</td>
                  <td>{r.title}{r.flags.map((f) => <span key={f} className="badge demo" style={{ marginLeft: "0.4rem" }}>{FLAG_LABEL[f] ?? f}</span>)}</td>
                  <td>{r.courseCode}</td>
                  <td>{r.authorName ?? "—"}</td>
                  <td className="nowrap">{[r.fileCount ? `${r.fileCount} file${r.fileCount === 1 ? "" : "s"}` : "", r.chars ? `${r.chars.toLocaleString("en-CA")} chars` : ""].filter(Boolean).join(" + ")}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td><button className="btn small secondary" onClick={() => openNote(r.id)} aria-label={`Open notes: ${r.title}`}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open !== null} onClose={close} title={open?.title ?? "Notes"}>
        {open && (
          <>
            <p className="small muted">{open.courseCode} · {open.courseTitle} · from {open.authorName ?? "unknown"} · received {open.createdAt.slice(0, 10)} · consent {open.consentVersion}, {open.consentedAt.slice(0, 10)}</p>
            {open.flags.length > 0 && <p className="notice warn" role="note">Check before using: {open.flags.map((f) => FLAG_LABEL[f] ?? f).join("; ")}. These are keyword hints only.</p>}
            {open.files.length > 0 && (
              <>
                <h3>Files</h3>
                <p className="notice warn small" role="note">Files are stored exactly as uploaded and are <b>not scanned</b>. Download them into a sandboxed viewer or straight into your AI tool, and do not open unfamiliar formats on a machine that holds anything sensitive. Each download is recorded in the audit log.</p>
                <ul>
                  {open.files.map((f) => (
                    <li key={f.id}><a href={`/api/moderation/notes/${open.id}/files/${f.id}`} download>{f.name}</a> <span className="muted small">({f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`})</span></li>
                  ))}
                </ul>
              </>
            )}
            {open.text && (
              <>
                <label htmlFor="note-body">Pasted text</label>
                <textarea id="note-body" readOnly value={open.text} style={{ minHeight: "12rem" }} />
              </>
            )}
            <div className="row" style={{ marginTop: "0.8rem" }}>
              {open.text && <button className="btn secondary" onClick={copy}>Copy text</button>}
              <button className="btn secondary" disabled={busy || open.status === "used"} onClick={() => setStatus("used")}>Mark as used</button>
              <button className="btn secondary" disabled={busy || open.status === "declined"} onClick={() => setStatus("declined")}>Decline</button>
              <button className="btn danger" disabled={busy} onClick={() => setConfirmDel(true)}>Delete…</button>
              <button className="btn secondary" onClick={close}>Close</button>
            </div>
            <p role="status" className="small muted">{copied ? "Copied to the clipboard." : `Status: ${open.status}.`}</p>
            {confirmDel && (
              <div className="notice bad" role="alertdialog" aria-label="Confirm deletion">
                <p>Permanently delete these notes{open?.files.length ? " and their files" : ""}? This cannot be undone.</p>
                <button className="btn danger" disabled={busy} onClick={remove}>Yes, delete permanently</button>{" "}
                <button className="btn secondary" onClick={() => setConfirmDel(false)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
