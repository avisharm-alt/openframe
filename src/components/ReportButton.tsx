"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Dialog } from "./Dialog";

const CATEGORIES: [string, string][] = [
  ["incorrect", "Incorrect answer or explanation"],
  ["ambiguous", "Ambiguous or more than one defensible answer"],
  ["irrelevant", "Irrelevant to the course or topic"],
  ["prohibited", "Looks like actual university assessment content, or copied material"],
  ["other", "Something else"],
];

export function ReportButton({ questionId }: { questionId: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("incorrect");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await api("POST", "/api/reports", { questionId, category, details });
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }
  return (
    <>
      <button className="link-btn small" onClick={() => { setOpen(true); setState("idle"); }} aria-haspopup="dialog">
        Report a problem<span className="sr-only"> with this question</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Report this question">
        {state === "done" ? (
          <>
            <p role="status">Thank you. A moderator will look at your report. Reports never remove a question automatically.</p>
            <button className="btn" onClick={() => setOpen(false)}>Close</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="rep-cat">What is wrong?</label>
            <select id="rep-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label htmlFor="rep-details">Details <span className="help">Optional. Please do not paste real exam material here.</span></label>
            <textarea id="rep-details" value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} />
            {error && <p role="alert" className="field-error">{error}</p>}
            <div className="row" style={{ marginTop: "1rem" }}>
              <button className="btn" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send report"}</button>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
