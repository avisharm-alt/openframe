"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { Dialog } from "./Dialog";
import {
  NOTES_AI_CONSENT_TEXT, NOTES_FILES_NOTE, NOTES_MAX_CHARS, NOTES_MAX_FILES, NOTES_MAX_FILE_BYTES, NOTES_MAX_REQUEST_BYTES, NOTES_MIN_CHARS, NOTES_OWN_WORK_TEXT, NOTES_PRIVACY_PROMISE,
} from "@/lib/attestation";
import type { MyNote } from "@/lib/services/notes";

type Course = { id: string; code: string; title: string; isDemo: boolean };
export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function NotesForm({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [ownWork, setOwnWork] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Adds picked files (the server checks type and content again). Limits are checked here only to give an instant message. */
  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    setError(null);
    const next = [...files];
    for (const f of picked) {
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (f.size === 0) { setError(`“${f.name}” is empty.`); continue; }
      if (f.size > NOTES_MAX_FILE_BYTES) { setError(`“${f.name}” is larger than ${NOTES_MAX_FILE_BYTES / 1048576} MB.`); continue; }
      next.push(f);
    }
    if (next.length > NOTES_MAX_FILES) { setError(`You can attach at most ${NOTES_MAX_FILES} files to one note.`); return; }
    if (next.reduce((n, f) => n + f.size, 0) > NOTES_MAX_REQUEST_BYTES) { setError(`The files together are larger than ${NOTES_MAX_REQUEST_BYTES / 1048576} MB.`); return; }
    setFiles(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("courseId", courseId);
      form.append("title", title);
      form.append("text", text);
      form.append("ownWork", String(ownWork));
      form.append("aiConsent", String(aiConsent));
      for (const f of files) form.append("files", f, f.name);
      const res = await fetch("/api/notes", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const er = (data as { error?: { code?: string; message?: string; details?: unknown } }).error ?? {};
        throw new ApiError(res.status, er.code ?? "error", er.message ?? "Something went wrong. Please try again.", er.details);
      }
      setSent("Thank you. Your notes were sent privately. You can delete them at any time below.");
      setTitle(""); setText(""); setFiles([]); setOwnWork(false); setAiConsent(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const det = err.details as { path?: string; message: string }[] | undefined;
        setError(Array.isArray(det) && det.length ? det.map((d) => d.message).join(" ") : err.message);
      } else setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (courses.length === 0) return <div className="notice warn">No courses are open for notes yet.</div>;
  return (
    <form onSubmit={onSubmit} aria-label="Share your notes" noValidate>
      <div className="notice" role="note"><p>{NOTES_PRIVACY_PROMISE}</p><p className="small">{NOTES_FILES_NOTE}</p></div>
      {sent && <p role="status" className="notice good">{sent}</p>}
      {error && <p role="alert" className="notice bad">{error}</p>}

      <label htmlFor="note-course">Course</label>
      <select id="note-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
      </select>

      <label htmlFor="note-title">Title <span className="help">For example “Week 3: recursion”. Do not put your name here.</span></label>
      <input id="note-title" type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />

      <label htmlFor="note-files">Attach files <span className="help">Optional if you paste your notes below. Up to {NOTES_MAX_FILES} files, {NOTES_MAX_FILE_BYTES / 1048576} MB each.</span></label>
      <input id="note-files" ref={fileRef} type="file" multiple onChange={onFiles} />
      {files.length > 0 && (
        <ul aria-label="Selected files">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}`}>
              {f.name} <span className="muted small">({fmtSize(f.size)})</span>{" "}
              <button type="button" className="link-btn small" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor="note-text">Pasted notes <span className="help">Optional if you attach files. Otherwise at least {NOTES_MIN_CHARS} characters, and at most {NOTES_MAX_CHARS.toLocaleString("en-CA")}.</span></label>
      <textarea id="note-text" style={{ minHeight: "12rem" }} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="note-count" />
      <p id="note-count" className="small muted">{text.length.toLocaleString("en-CA")} / {NOTES_MAX_CHARS.toLocaleString("en-CA")} characters</p>

      <fieldset>
        <legend>Before you send</legend>
        <label className="check"><input type="checkbox" checked={ownWork} onChange={(e) => setOwnWork(e.target.checked)} /><span>{NOTES_OWN_WORK_TEXT}</span></label>
        <label className="check"><input type="checkbox" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} /><span>{NOTES_AI_CONSENT_TEXT}</span></label>
      </fieldset>
      <button className="btn" disabled={busy || !ownWork || !aiConsent || !courseId || (files.length === 0 && text.trim().length < NOTES_MIN_CHARS)}>{busy ? "Sending…" : "Send notes privately"}</button>
    </form>
  );
}

export function MyNotes({ notes }: { notes: MyNote[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<MyNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (notes.length === 0) return <p className="muted">You have not sent any notes.</p>;
  async function remove() {
    if (!target) return;
    setBusy(true); setError(null);
    try { await api("DELETE", `/api/notes/${target.id}`); setTarget(null); router.refresh(); } catch (e) { setError((e as Error).message); setTarget(null); } finally { setBusy(false); }
  }
  const STATUS: Record<string, string> = { new: "Waiting", used: "Used for questions", declined: "Not used" };
  return (
    <>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Your notes (scrollable)">
        <table>
          <caption className="sr-only">Notes you have sent</caption>
          <thead><tr><th scope="col">Title</th><th scope="col">Files</th><th scope="col">Course</th><th scope="col">Sent</th><th scope="col">Deleted automatically</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id}>
                <td>{n.title}</td>
                <td>{n.files.length === 0 ? <span className="muted">Pasted text</span> : n.files.map((f) => <div key={f.name} className="small">{f.name} <span className="muted">({fmtSize(f.size)})</span></div>)}</td>
                <td>{n.courseCode}</td>
                <td className="nowrap">{n.createdAt.slice(0, 10)}</td>
                <td className="nowrap">{n.expiresAt.slice(0, 10)}</td>
                <td><span className="badge">{STATUS[n.status] ?? n.status}</span></td>
                <td><button className="btn small danger" onClick={() => setTarget(n)} aria-label={`Delete notes: ${n.title}`}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={target !== null} onClose={() => setTarget(null)} title="Delete these notes?">
        <p>“{target?.title}” and any files attached to it will be permanently deleted. Questions already written from them are not affected.</p>
        <div className="row"><button className="btn danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete permanently"}</button><button className="btn secondary" onClick={() => setTarget(null)}>Keep them</button></div>
      </Dialog>
    </>
  );
}
