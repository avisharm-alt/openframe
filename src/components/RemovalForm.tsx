"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";

export function RemovalForm() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const qid = String(f.get("qid") || "").trim();
    setState("busy"); setError(null);
    try {
      await api("POST", "/api/reports", { category: "removal_request", details: String(f.get("details")), ...(qid ? { questionId: qid } : {}) });
      setState("done");
    } catch (err) { setError((err as Error).message); setState("idle"); }
  }
  if (state === "done") return <p role="status" className="notice good">Request received. A moderator will review it.</p>;
  return (
    <form onSubmit={onSubmit} className="card">
      <label htmlFor="qid">Question ID <span className="help">Optional, if you have it (shown in the address of a question’s report link).</span></label>
      <input id="qid" name="qid" type="text" pattern="[0-9a-fA-F-]{36}" title="A question ID looks like 123e4567-e89b-12d3-a456-426614174000" />
      <label htmlFor="details">What should be removed and why?</label>
      <textarea id="details" name="details" required minLength={10} maxLength={2000} />
      {error && <p role="alert" className="field-error">{error}</p>}
      <p><button className="btn" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send request"}</button></p>
    </form>
  );
}
