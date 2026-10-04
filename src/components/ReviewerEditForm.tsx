"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";
import { ATTESTATION_TEXT } from "@/lib/attestation";
import type { ReviewNav } from "@/lib/services/moderation";

type Opt = { id: string; text: string; explanation: string };
type Issue = { field: string; message: string };

/**
 * A reviewer corrects a question while reviewing it. Saving does not change the live question: it creates a new revision
 * authored by the reviewer, which two other reviewers must approve before it replaces the current one.
 */
export function ReviewerEditForm({ revisionId, options, correctOptionId, initial, nav, onCancel }: {
  revisionId: string;
  options: Opt[];
  correctOptionId: string | null;
  initial: { stem: string; learningObjective: string; difficulty: string };
  nav: ReviewNav;
  onCancel: () => void;
}) {
  const [stem, setStem] = useState(initial.stem);
  const [objective, setObjective] = useState(initial.learningObjective);
  const [difficulty, setDifficulty] = useState(initial.difficulty || "intermediate");
  const [opts, setOpts] = useState<Opt[]>(options);
  const [correct, setCorrect] = useState(correctOptionId ?? "");
  const [summary, setSummary] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ revisionId: string; number: number } | null>(null);
  const err = (f: string) => errors.find((e) => e.field === f)?.message;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrors([]); setMessage(null);
    try {
      const r = await api<{ revisionId: string; number: number }>("POST", `/api/moderation/revisions/${revisionId}/edit`, {
        stem, learningObjective: objective, difficulty, options: opts, correctOptionId: correct, summary, attested,
      });
      setSaved(r);
    } catch (ex) {
      if (ex instanceof ApiError) {
        const d = ex.details as { errors?: Issue[] } | { path: string; message: string }[] | undefined;
        if (Array.isArray(d)) setErrors(d.map((x) => ({ field: x.path, message: x.message })));
        else if (d?.errors) setErrors(d.errors);
        setMessage(ex.message);
      } else setMessage("Could not save. Please try again.");
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="notice good" role="status">
        <p>Saved as revision {saved.number}. The current version stays live until two other reviewers approve your edit; you cannot approve your own edit or this question any more.</p>
        <p className="row">
          <Link className="btn small" href={`/moderation/revisions/${saved.revisionId}?list=${nav.list}`}>View revision {saved.number}</Link>
          {nav.nextId && <Link className="btn small secondary" href={`/moderation/revisions/${nav.nextId}?list=${nav.list}`}>Next question →</Link>}
          <Link className="btn small secondary" href={`/moderation?tab=${nav.list === "verify" ? "verify" : "submissions"}`}>Back to the queue</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={save} aria-label="Edit question">
      <h2 style={{ marginTop: 0 }}>Edit this question</h2>
      <p className="small muted">Your edit becomes a new revision credited to you. It needs approvals from two other reviewers before it replaces the live question.</p>
      <label htmlFor="edit-stem">Question stem <span className="help">Markdown and LaTeX are supported.</span></label>
      <textarea id="edit-stem" value={stem} maxLength={3000} onChange={(e) => setStem(e.target.value)} aria-invalid={!!err("stem")} />
      {err("stem") && <p className="field-error">{err("stem")}</p>}
      <label htmlFor="edit-objective">Learning objective</label>
      <input id="edit-objective" value={objective} maxLength={300} onChange={(e) => setObjective(e.target.value)} aria-invalid={!!err("learningObjective")} />
      {err("learningObjective") && <p className="field-error">{err("learningObjective")}</p>}
      <label htmlFor="edit-difficulty">Suggested difficulty</label>
      <select id="edit-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
        <option value="introductory">Introductory</option>
        <option value="intermediate">Intermediate</option>
        <option value="challenging">Challenging</option>
      </select>
      <fieldset>
        <legend>Options (choose the correct one)</legend>
        {opts.map((o, i) => (
          <div key={o.id} className="card" style={{ margin: "0.5rem 0" }}>
            <label className="check">
              <input type="radio" name="edit-correct" checked={correct === o.id} onChange={() => setCorrect(o.id)} />
              <span>Option {i + 1} is correct</span>
            </label>
            <label htmlFor={`edit-opt-${i}`}>Option {i + 1} text</label>
            <input id={`edit-opt-${i}`} value={o.text} maxLength={500} aria-invalid={!!err(`options.${i}.text`)}
              onChange={(e) => setOpts(opts.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))} />
            {err(`options.${i}.text`) && <p className="field-error">{err(`options.${i}.text`)}</p>}
            <label htmlFor={`edit-exp-${i}`}>Option {i + 1} explanation</label>
            <textarea id={`edit-exp-${i}`} style={{ minHeight: "4rem" }} value={o.explanation} maxLength={2000} aria-invalid={!!err(`options.${i}.explanation`)}
              onChange={(e) => setOpts(opts.map((x) => (x.id === o.id ? { ...x, explanation: e.target.value } : x)))} />
            {err(`options.${i}.explanation`) && <p className="field-error">{err(`options.${i}.explanation`)}</p>}
          </div>
        ))}
        {err("correctOptionId") && <p className="field-error">{err("correctOptionId")}</p>}
      </fieldset>
      <label htmlFor="edit-summary">What did you change? <span className="help">Optional, up to 200 characters. Shown in the audit log, so keep it free of personal details.</span></label>
      <input id="edit-summary" value={summary} maxLength={200} onChange={(e) => setSummary(e.target.value)} />
      <label className="check" style={{ marginTop: "0.8rem" }}>
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
        <span>{ATTESTATION_TEXT}</span>
      </label>
      {message && <p role="alert" className="field-error">{message}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn" disabled={busy || !attested}>{busy ? "Saving…" : "Save as a new revision"}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
