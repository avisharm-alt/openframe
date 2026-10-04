"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CourseNotesUpload({ courses }: { courses: { id: string; code: string; title: string; universityName: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  return <form onSubmit={async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    setError(""); setSuccess("");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) { setError("Choose a non-empty PDF or text file up to 10 MB."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/course-notes", { method: "POST", body: data });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Upload failed. Please try again.");
      setSuccess("Your notes were uploaded. The OpenFrame team can now access them.");
      form.reset();
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed. Please try again."); }
    finally { setBusy(false); }
  }} style={{ maxWidth: "38rem" }}>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
      <label htmlFor="notes-course">Course</label>
      <select id="notes-course" name="courseId" required defaultValue="">
        <option value="" disabled>Choose a course</option>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title} · {c.universityName}</option>)}
      </select>
      <label htmlFor="notes-file">Course notes</label>
      <input id="notes-file" name="file" type="file" accept=".pdf,.txt,application/pdf,text/plain" required aria-describedby="notes-file-help" />
      <p id="notes-file-help" className="muted small">PDF or plain text · up to 10 MB per file.</p>
      <label style={{ display: "flex", gap: "0.65rem", alignItems: "start", margin: "1.25rem 0" }}>
        <input type="checkbox" name="permission" value="true" required style={{ width: "auto", marginTop: "0.3rem" }} />
        <span>I wrote these notes or have permission to share them with OpenFrame. They contain no exam or quiz questions or personal information.</span>
      </label>
      <button className="btn" disabled={!courses.length}>{busy ? "Uploading…" : "Upload course notes"}</button>
    </fieldset>
    {error && <p className="notice bad" role="alert">{error}</p>}
    {success && <p className="notice" role="status">{success}</p>}
  </form>;
}

export function RemoveCourseNote({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <button className="btn secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const res = await fetch("/api/course-notes/" + id, { method: "DELETE" });
        if (!res.ok) throw new Error("Could not remove the upload. Please try again.");
        router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : "Could not remove the upload."); }
      finally { setBusy(false); }
    }}>{busy ? "Removing…" : "Remove"}</button>
    {error && <p className="small" role="alert">{error}</p>}
  </>;
}
