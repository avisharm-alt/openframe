"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { CHECKLIST_LABELS, REVIEW_CHECKLIST } from "@/lib/types";
import { STRUCTURAL_CHECK_NOTE, VERIFIED_EXPLAINER } from "@/lib/copy";
import type { ReviewNav } from "@/lib/services/moderation";
import { ReviewerEditForm } from "./ReviewerEditForm";

type Decision = "approve" | "request_changes" | "reject";
type Opt = { id: string; text: string; explanation: string };
const SHORTCUTS_KEY = "openframe.review.shortcuts";

export type ReviewWorkspaceProps = {
  revisionId: string;
  questionId: string;
  /** What a decision means here; null when this revision is not awaiting review or verification. */
  kind: "submission" | "verification" | null;
  canReview: boolean;
  canEdit: boolean;
  wroteIt: boolean;
  alreadyApproved: boolean;
  approvals: number;
  required: number;
  approvedBy: string[];
  objected: boolean;
  nav: ReviewNav;
  options: Opt[];
  correctOptionId: string | null;
  /** The stem, rendered as Markdown on the server. */
  stem: React.ReactNode;
  edit: { stem: string; learningObjective: string; difficulty: string };
};

const hrefFor = (id: string, nav: ReviewNav) => `/moderation/revisions/${id}?list=${nav.list}`;
const queueHref = (nav: ReviewNav) => `/moderation?tab=${nav.list === "verify" ? "verify" : "submissions"}`;

export function ReviewWorkspace(p: ReviewWorkspaceProps) {
  const router = useRouter();
  const decisive = p.kind !== null && p.canReview;
  // The key is hidden until the reviewer commits to their own answer. This is a nudge, not a security boundary:
  // the checklist item below is the reviewer's attestation.
  const [ownAnswer, setOwnAnswer] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(!decisive);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [publicNote, setPublicNote] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [intent, setIntent] = useState<Decision | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [editing, setEditing] = useState(false);
  const [shortcuts, setShortcuts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const checklistRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage, which only exists in the browser
      setShortcuts(localStorage.getItem(SHORTCUTS_KEY) !== "0");
    } catch { /* default on */ }
  }, []);
  function setShortcutsPref(on: boolean) {
    setShortcuts(on);
    try { localStorage.setItem(SHORTCUTS_KEY, on ? "1" : "0"); } catch { /* preference just won't persist */ }
  }

  const tickable = REVIEW_CHECKLIST.filter((k) => k !== "independent_answer" || ownAnswer !== null);
  const allTicked = REVIEW_CHECKLIST.every((k) => checks[k]);
  const willComplete = p.approvals + 1 >= p.required && !p.objected;
  const goNext = useCallback(() => {
    if (p.nav.nextId) router.push(hrefFor(p.nav.nextId, p.nav));
    else router.push(queueHref(p.nav));
    router.refresh();
  }, [p.nav, router]);

  const announce = (m: string) => { setStatus(""); setTimeout(() => setStatus(m), 30); };

  const decide = useCallback(async (decision: Decision) => {
    if (busy || !decisive) return;
    setError(null);
    if (decision === "approve") {
      if (!allTicked) {
        announce(ownAnswer === null ? "Pick your own answer first, then tick every checklist item." : "Tick every checklist item before approving.");
        checklistRef.current?.querySelector("input")?.focus();
        return;
      }
    } else if (!publicNote.trim()) {
      setIntent(decision);
      setConfirmReject(false);
      announce(decision === "reject" ? "Write the reason, then press Control and Enter, or use the Reject button." : "Write what needs to change, then press Control and Enter, or use the Request changes button.");
      noteRef.current?.focus();
      return;
    } else if (decision === "reject" && !confirmReject) {
      setConfirmReject(true);
      announce(p.kind === "verification" ? "Rejecting withdraws this published question. Press reject again to confirm." : "Rejecting closes this submission. Press reject again to confirm.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ verified: boolean; published: boolean; approvals: number; withdrawn: boolean }>("POST", `/api/moderation/revisions/${p.revisionId}/review`, { decision, checklist: checks, publicNote, privateNote });
      announce(decision === "approve" ? (r.verified ? "Approved. This question is now verified." : `Approved. ${r.approvals} of ${p.required} approvals.`) : decision === "reject" ? "Rejected." : "Changes requested.");
      goNext();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [allTicked, busy, checks, confirmReject, decisive, goNext, ownAnswer, p.kind, p.required, p.revisionId, privateNote, publicNote]);

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" ||
        (el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type)));
      if (e.key === "Escape" && el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) { el.blur(); return; }
      if (typing || editing || busy) return;
      const k = e.key.toLowerCase();
      if (/^[1-5]$/.test(k) && decisive && !revealed) {
        const opt = p.options[Number(k) - 1];
        if (opt) { e.preventDefault(); setOwnAnswer(opt.id); setRevealed(true); announce(`You chose option ${k}. The key is now shown.`); }
      } else if (k === "t" && decisive && revealed) {
        e.preventDefault();
        const on = !tickable.every((c) => checks[c]);
        setChecks(Object.fromEntries(tickable.map((c) => [c, on])));
        announce(on ? "All checklist items ticked." : "Checklist cleared.");
      } else if (k === "a" && decisive) { e.preventDefault(); void decide("approve"); }
      else if (k === "c" && decisive) { e.preventDefault(); void decide("request_changes"); }
      else if (k === "r" && decisive) { e.preventDefault(); void decide("reject"); }
      else if (k === "e" && p.canEdit) { e.preventDefault(); setEditing(true); }
      else if (k === "n" && p.nav.nextId) { e.preventDefault(); router.push(hrefFor(p.nav.nextId, p.nav)); }
      else if (k === "p" && p.nav.prevId) { e.preventDefault(); router.push(hrefFor(p.nav.prevId, p.nav)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, checks, decide, decisive, editing, p.canEdit, p.nav, p.options, revealed, router, shortcuts, tickable]);

  async function withdraw() {
    const reason = window.prompt("Reason for withdrawing this question (logged in the audit trail):");
    if (!reason) return;
    try { await api("POST", `/api/moderation/questions/${p.questionId}/withdraw`, { reason }); goNext(); } catch (e) { setError((e as Error).message); }
  }

  const match = ownAnswer !== null && p.correctOptionId !== null ? ownAnswer === p.correctOptionId : null;

  return (
    <>
      <nav className="row space" aria-label="Queue navigation" style={{ margin: "0.5rem 0" }}>
        <span className="small muted">
          {p.nav.position > 0 ? `Item ${p.nav.position} of ${p.nav.total}` : "Not in this queue"} · {p.nav.todo} left for you ·{" "}
          <Link href={queueHref(p.nav)}>Back to the queue</Link>
        </span>
        <span className="row">
          {p.nav.prevId ? <Link className="btn small secondary" href={hrefFor(p.nav.prevId, p.nav)} aria-keyshortcuts="p">← Previous (p)</Link> : <span className="btn small secondary" aria-disabled="true">← Previous (p)</span>}
          {p.nav.nextId ? <Link className="btn small secondary" href={hrefFor(p.nav.nextId, p.nav)} aria-keyshortcuts="n">Next (n) →</Link> : <span className="btn small secondary" aria-disabled="true">Next (n) →</span>}
        </span>
      </nav>

      <div className="card">
        {p.stem}
        {decisive && !revealed ? (
          <fieldset>
            <legend>Work out the answer first. The key is hidden until you choose.</legend>
            {p.options.map((o, i) => (
              <label key={o.id} className="check">
                <input type="radio" name="own-answer" checked={ownAnswer === o.id} onChange={() => { setOwnAnswer(o.id); setRevealed(true); announce(`You chose option ${i + 1}. The key is now shown.`); }} />
                <span>{i + 1}. {o.text}</span>
              </label>
            ))}
            <p className="small muted">Press a number key to choose and show the key.</p>
            <button type="button" className="btn small secondary" onClick={() => { setRevealed(true); announce("The key is shown. You skipped working out your own answer, so you cannot approve this question."); }}>Show the key without answering</button>
          </fieldset>
        ) : (
          <>
            <ol>
              {p.options.map((o) => (
                <li key={o.id} style={{ margin: "0.6rem 0" }}>
                  <b>{o.id === p.correctOptionId ? "✓ Correct: " : ""}</b>{o.text}
                  {ownAnswer === o.id && <span className="badge">your answer</span>}
                  <div className="small muted">{o.explanation}</div>
                </li>
              ))}
            </ol>
            {decisive && match !== null && (
              <p role="status" className={match ? "small" : "notice warn"}>
                {match ? "Your answer matches the key." : "Your answer differs from the key. Check the question carefully before approving: the key may be wrong, or the question ambiguous."}
              </p>
            )}
          </>
        )}
      </div>

      {p.canEdit && (
        <div style={{ margin: "0.8rem 0" }}>
          {!editing ? (
            <button type="button" className="btn secondary" onClick={() => setEditing(true)} aria-keyshortcuts="e">Edit this question (e)</button>
          ) : (
            <ReviewerEditForm
              revisionId={p.revisionId}
              options={p.options}
              correctOptionId={p.correctOptionId}
              initial={p.edit}
              nav={p.nav}
              onCancel={() => setEditing(false)}
            />
          )}
        </div>
      )}

      {p.kind === null ? (
        <div className="notice" role="note">This revision is not awaiting review or verification, so there is nothing to decide here.</div>
      ) : !p.canReview ? (
        <div className="notice warn" role="alert">
          {p.wroteIt ? "You wrote or edited this question, so other reviewers must review it." : "You have already approved this revision. A different reviewer must give the next approval."}{" "}
          Approvals so far: {p.approvals} of {p.required}{p.approvedBy.length ? ` (${p.approvedBy.join(", ")})` : ""}.
        </div>
      ) : (
        <form className="card" onSubmit={(e) => e.preventDefault()} aria-label="Review decision">
          <h2 style={{ marginTop: 0 }}>Your review</h2>
          <p>
            {p.kind === "verification"
              ? "This question is already published as unverified. "
              : "This submission is not published until it has enough approvals. "}
            Approvals so far: <b>{p.approvals} of {p.required}</b>{p.approvedBy.length ? ` (${p.approvedBy.join(", ")})` : ""}.{" "}
            {willComplete ? "Your approval completes the verification." : "A second, different reviewer must also approve."}
            {p.objected && " A reviewer has asked for changes, so it cannot be verified until they approve or the question is edited."}
          </p>
          <p className="small muted">{VERIFIED_EXPLAINER} {STRUCTURAL_CHECK_NOTE}</p>
          <fieldset ref={checklistRef}>
            <legend>Checklist (all required to approve)</legend>
            {REVIEW_CHECKLIST.map((k) => {
              const locked = k === "independent_answer" && ownAnswer === null;
              return (
                <label key={k} className="check">
                  <input type="checkbox" checked={!!checks[k]} disabled={locked} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} />
                  <span>{CHECKLIST_LABELS[k]}{locked && <span className="help">Available once you have chosen your own answer before seeing the key.</span>}</span>
                </label>
              );
            })}
          </fieldset>
          <label htmlFor="pub">Note to the contributor <span className="help">Required when requesting changes or rejecting. Visible to the contributor. For a published import it becomes the reason the question is withdrawn.</span></label>
          <textarea id="pub" ref={noteRef} value={publicNote} maxLength={1500} onChange={(e) => { setPublicNote(e.target.value); setConfirmReject(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && intent) { e.preventDefault(); void decide(intent); } }} />
          <label htmlFor="priv">Private note <span className="help">Visible to reviewers only.</span></label>
          <textarea id="priv" style={{ minHeight: "4rem" }} value={privateNote} maxLength={1500} onChange={(e) => setPrivateNote(e.target.value)} />
          {error && <p role="alert" className="field-error">{error}</p>}
          {confirmReject && <p role="alert" className="field-error">{p.kind === "verification" ? "Rejecting withdraws this published question." : "Rejecting closes this submission."} Press Reject again to confirm.</p>}
          <div className="row" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn" disabled={!allTicked || busy} aria-keyshortcuts="a" onClick={() => decide("approve")}>
              {willComplete ? "Approve and mark verified (a)" : `Approve, approval ${p.approvals + 1} of ${p.required} (a)`}
            </button>
            <button type="button" className="btn secondary" disabled={busy} aria-keyshortcuts="c" onClick={() => decide("request_changes")}>Request changes (c)</button>
            <button type="button" className="btn danger" disabled={busy} aria-keyshortcuts="r" onClick={() => decide("reject")}>{confirmReject ? "Confirm reject (r)" : "Reject (r)"}</button>
            <button className="btn secondary" type="button" onClick={withdraw}>Withdraw question…</button>
          </div>
        </form>
      )}

      <div className="card small" style={{ marginTop: "0.8rem" }}>
        <label className="check" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={shortcuts} onChange={(e) => setShortcutsPref(e.target.checked)} />
          <span>Keyboard shortcuts <span className="help">Single-key shortcuts are only active while this is ticked and you are not typing in a field.</span></span>
        </label>
        <details>
          <summary>Which keys?</summary>
          <dl className="shortcuts">
            <dt><kbd>1</kbd>–<kbd>5</kbd></dt><dd>choose your own answer (shows the key)</dd>
            <dt><kbd>t</kbd></dt><dd>tick or clear the whole checklist, after you have seen the key</dd>
            <dt><kbd>a</kbd></dt><dd>approve (needs a complete checklist)</dd>
            <dt><kbd>c</kbd></dt><dd>request changes (jumps to the note; then <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends it)</dd>
            <dt><kbd>r</kbd></dt><dd>reject (needs a note and a second press to confirm)</dd>
            <dt><kbd>e</kbd></dt><dd>edit the question (creates a new revision)</dd>
            <dt><kbd>n</kbd> / <kbd>p</kbd></dt><dd>next / previous question</dd>
            <dt><kbd>Esc</kbd></dt><dd>leave a text field so the shortcuts work again</dd>
          </dl>
        </details>
      </div>
      <div role="status" aria-live="polite" className="sr-only">{status}</div>
    </>
  );
}
