"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";

export function CourseRequestForm({ initialCode = "", universities, universitySlug }: { initialCode?: string; universities?: { slug: string; name: string }[]; universitySlug?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("busy");
    setError(null);
    try {
      await api("POST", "/api/course-requests", { universitySlug: String(f.get("universitySlug")), code: String(f.get("code")), title: String(f.get("title") || ""), note: String(f.get("note") || "") });
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }
  if (state === "done") return <p role="status" className="notice good">Thanks. Your request was recorded for the maintainers. It does not guarantee a course will be added.</p>;
  return (
    <form onSubmit={onSubmit} className="card">
      <h2 style={{ marginTop: 0 }}>Request a course</h2>
      <p className="muted small">Course coverage is added by volunteers. Tell us which course you would like to see; we do not collect grades or student numbers.</p>
      {universitySlug ? <input type="hidden" name="universitySlug" value={universitySlug} /> : (
        <>
          <label htmlFor="rc-university">University</label>
          <select id="rc-university" name="universitySlug" required defaultValue="">
            <option value="" disabled>Select a university</option>
            {universities?.map((u) => <option key={u.slug} value={u.slug}>{u.name}</option>)}
          </select>
        </>
      )}
      <label htmlFor="rc-code">Course code</label>
      <input id="rc-code" name="code" type="text" required minLength={2} maxLength={30} defaultValue={initialCode} />
      <label htmlFor="rc-title">Course title <span className="help">Optional</span></label>
      <input id="rc-title" name="title" type="text" maxLength={120} />
      <label htmlFor="rc-note">Anything else? <span className="help">Optional</span></label>
      <textarea id="rc-note" name="note" maxLength={1000} style={{ minHeight: "4rem" }} />
      {error && <p role="alert" className="field-error">{error}</p>}
      <p><button className="btn" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send request"}</button></p>
    </form>
  );
}
