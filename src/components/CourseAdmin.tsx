"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import type { AdminCourse } from "@/lib/services/catalog-admin";

const FIELD_LABELS: Record<string, string> = {
  universitySlug: "University",
  code: "Course code",
  title: "Title",
  subject: "Subject",
  description: "Description",
  outline: "Outline",
  text: "Outline",
};

/** Turns an API failure into one readable sentence, naming the field when the server validated one. */
function errorText(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    const parts = (e.details as { path?: string; message?: string }[])
      .filter((d) => d.message)
      .map((d) => (d.path && FIELD_LABELS[d.path] ? `${FIELD_LABELS[d.path]}: ${d.message}` : d.message));
    if (parts.length) return parts.join(" ");
  }
  return e instanceof Error ? e.message : "Something went wrong. Please try again.";
}

/**
 * Runs a mutation, then refreshes the server-rendered page. Keeps a polite status line for screen readers and ignores
 * clicks while a request is in flight (without disabling buttons, which would drop keyboard focus).
 */
function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** `scope` names the part of the page an error belongs to, so it can be shown next to what caused it. */
  async function run<T>(fn: () => Promise<T>, done: string | ((result: T) => string), scope?: string): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      const result = await fn();
      setStatus(typeof done === "function" ? done(result) : done);
      router.refresh();
      return true;
    } catch (e) {
      setError(errorText(e));
      setErrorScope(scope ?? null);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { error, errorScope, status, busy, run, router };
}

const OUTLINE_HELP = (
  <>
    One unit per line, with its topics underneath, each starting with “-”. Blank lines are ignored. Only enter units and topics you have verified; do not
    invent them.
  </>
);
const OUTLINE_EXAMPLE = "Foundations\n- Variables and types\n- Expressions\n\nControl flow\n- Conditionals\n- Loops";

export function CreateCourseForm({
  universities,
  initial,
  requestId,
}: {
  universities: { slug: string; name: string }[];
  initial?: { universitySlug?: string | null; code?: string; title?: string };
  requestId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("POST", "/api/moderation/courses", {
        universitySlug: text("universitySlug"),
        code: text("code"),
        title: text("title"),
        subject: text("subject"),
        description: text("description"),
        outline: text("outline"),
        ...(requestId ? { requestId } : {}),
      });
      router.push(`/moderation/courses/${r.id}`);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <form className="card" onSubmit={onSubmit} aria-label="New course">
      <label htmlFor="nc-university">University</label>
      <select id="nc-university" name="universitySlug" required defaultValue={initial?.universitySlug ?? ""}>
        <option value="" disabled>Select a university</option>
        {universities.map((u) => <option key={u.slug} value={u.slug}>{u.name}</option>)}
      </select>
      <label htmlFor="nc-code">Course code <span className="help">As the university writes it, for example CS 1026A. Each university can use a code once.</span></label>
      <input id="nc-code" name="code" type="text" required minLength={2} maxLength={30} defaultValue={initial?.code ?? ""} />
      <label htmlFor="nc-title">Title</label>
      <input id="nc-title" name="title" type="text" required maxLength={120} defaultValue={initial?.title ?? ""} />
      <label htmlFor="nc-subject">Subject <span className="help">Shown under the title and searchable, for example Computer Science.</span></label>
      <input id="nc-subject" name="subject" type="text" required maxLength={80} />
      <label htmlFor="nc-description">Description <span className="help">Optional. One or two plain sentences. Do not copy an official course description unless you have the right to.</span></label>
      <textarea id="nc-description" name="description" maxLength={1000} style={{ minHeight: "4.5rem" }} />
      <label htmlFor="nc-outline">Units and topics <span className="help" id="nc-outline-help">Optional; you can also add them later. {OUTLINE_HELP}</span></label>
      <textarea id="nc-outline" name="outline" maxLength={10000} aria-describedby="nc-outline-help nc-outline-example" placeholder={OUTLINE_EXAMPLE} />
      <p className="help" id="nc-outline-example">Example:</p>
      <pre className="small" style={{ margin: "0 0 1rem" }}>{OUTLINE_EXAMPLE}</pre>
      {error && <p role="alert" className="field-error">{error}</p>}
      <p style={{ marginBottom: 0 }}><button className="btn" disabled={busy}>{busy ? "Creating…" : "Create course"}</button></p>
    </form>
  );
}

export function CourseDetailsForm({ course }: { course: AdminCourse }) {
  const { error, status, busy, run } = useAction();
  const [code, setCode] = useState(course.code);
  const [title, setTitle] = useState(course.title);
  const [subject, setSubject] = useState(course.subject);
  const [description, setDescription] = useState(course.description);
  return (
    <form
      className="card"
      aria-label="Course details"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api("PATCH", `/api/moderation/courses/${course.id}`, { code, title, subject, description }), "Course details saved.");
      }}
    >
      <label htmlFor="cd-code" style={{ marginTop: 0 }}>Course code</label>
      <input id="cd-code" type="text" required minLength={2} maxLength={30} value={code} onChange={(e) => setCode(e.target.value)} />
      <label htmlFor="cd-title">Title</label>
      <input id="cd-title" type="text" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="cd-subject">Subject</label>
      <input id="cd-subject" type="text" required maxLength={80} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <label htmlFor="cd-description">Description <span className="help">Optional.</span></label>
      <textarea id="cd-description" maxLength={1000} style={{ minHeight: "4.5rem" }} value={description} onChange={(e) => setDescription(e.target.value)} />
      {error && <p role="alert" className="field-error">{error}</p>}
      <p style={{ marginBottom: 0 }}>
        <button className="btn" disabled={busy}>Save details</button>
        <span role="status" className="small muted" style={{ marginLeft: "0.8rem" }}>{status}</span>
      </p>
    </form>
  );
}

/** Archive / restore / delete. Archiving is the normal way to retire a course; deleting is only possible while it has no questions. */
export function CourseStatusActions({ course }: { course: AdminCourse }) {
  const { error, status, run, router } = useAction();
  const archived = course.status === "archived";
  function toggle() {
    const warning = archived
      ? `Restore ${course.code}? It will appear in the directory and accept practice sessions and contributions again.`
      : `Archive ${course.code}? It disappears from the directory, search, practice setup and new contributions${course.publishedCount ? `, so its ${course.publishedCount} published question${course.publishedCount === 1 ? "" : "s"} can no longer be practised` : ""}. You can restore it later.`;
    if (!window.confirm(warning)) return;
    run(() => api("PATCH", `/api/moderation/courses/${course.id}`, { status: archived ? "active" : "archived" }), archived ? "Course restored." : "Course archived.");
  }
  async function remove() {
    if (!window.confirm(`Permanently delete ${course.code} and its ${course.units.length} unit${course.units.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    const ok = await run(() => api("DELETE", `/api/moderation/courses/${course.id}`), "Course deleted.");
    if (ok) router.push("/moderation?tab=courses");
  }
  return (
    <div className="card">
      <p style={{ marginTop: 0 }}>
        {archived
          ? "This course is archived: learners cannot see it. Its questions are kept."
          : "This course is live: it appears in the directory, in search and in practice setup."}
      </p>
      <div className="row">
        <button type="button" className={archived ? "btn" : "btn secondary"} onClick={toggle}>{archived ? "Restore course" : "Archive course"}</button>
        {course.questionCount === 0 ? (
          <button type="button" className="btn danger" onClick={remove}>Delete course</button>
        ) : (
          <span className="small muted">Courses with questions cannot be deleted; archive them instead.</span>
        )}
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}
      <p role="status" className="small muted" style={{ marginBottom: 0 }}>{status}</p>
    </div>
  );
}

export function StructureEditor({ course }: { course: AdminCourse }) {
  const { error, errorScope, status, run } = useAction();
  const [newUnit, setNewUnit] = useState("");
  const [newTopics, setNewTopics] = useState<Record<string, string>>({});
  // After a change the server re-renders the list; put keyboard focus somewhere sensible instead of losing it.
  const focusAfter = useRef<string[]>([]);
  useEffect(() => {
    const ids = focusAfter.current;
    focusAfter.current = [];
    for (const id of ids) {
      const el = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null;
      if (el && !el.disabled) {
        el.focus();
        break;
      }
    }
  }, [course]);

  /** Errors appear inside the unit card the action belongs to (or beside the "New unit" form), not at the foot of the page. */
  const errorIn = (scope: string) => (error && errorScope === scope ? <p role="alert" className="field-error">{error}</p> : null);

  function rename(kind: "unit" | "topic", id: string, current: string, scope: string) {
    const next = window.prompt(`Rename the ${kind} “${current}”:`, current);
    if (next === null || next.trim() === "" || next.trim() === current) return;
    run(() => api("PATCH", `/api/moderation/${kind}s/${id}`, { title: next }), `Renamed to “${next.trim()}”.`, scope);
  }
  function move(kind: "unit" | "topic", id: string, title: string, direction: "up" | "down", scope: string) {
    // Keep focus on the same control; if the item reached an end and that button is now disabled, use the other one.
    focusAfter.current = [`${direction}-${kind}-${id}`, `${direction === "up" ? "down" : "up"}-${kind}-${id}`];
    run(() => api("PATCH", `/api/moderation/${kind}s/${id}`, { move: direction }), `Moved “${title}” ${direction}.`, scope);
  }
  function remove(kind: "unit" | "topic", id: string, title: string, afterFocus: string, scope: string, extra = "") {
    if (!window.confirm(`Delete the ${kind} “${title}”?${extra} This cannot be undone.`)) return;
    focusAfter.current = [afterFocus];
    run(() => api("DELETE", `/api/moderation/${kind}s/${id}`), `Deleted “${title}”.`, scope);
  }
  async function addTopic(e: React.FormEvent, unitId: string) {
    e.preventDefault();
    const title = newTopics[unitId] ?? "";
    if (await run(() => api("POST", `/api/moderation/units/${unitId}/topics`, { title }), `Added the topic “${title.trim()}”.`, unitId)) {
      setNewTopics({ ...newTopics, [unitId]: "" });
    }
  }
  async function addUnit(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => api("POST", `/api/moderation/courses/${course.id}/units`, { title: newUnit }), `Added the unit “${newUnit.trim()}”.`, "new-unit")) setNewUnit("");
  }

  return (
    <div>
      {course.units.length === 0 && <p className="muted">This course has no units yet. Add one below, or paste an outline.</p>}
      {course.units.map((u, ui) => (
        <section key={u.id} className="card" aria-labelledby={`unit-${u.id}`}>
          <div className="row space">
            <h3 id={`unit-${u.id}`} style={{ margin: 0 }}>{u.title}</h3>
            <div className="row">
              <button type="button" className="btn small secondary" onClick={() => rename("unit", u.id, u.title, u.id)} aria-label={`Rename unit ${u.title}`}>Rename</button>
              <button type="button" id={`up-unit-${u.id}`} className="btn small secondary" disabled={ui === 0} onClick={() => move("unit", u.id, u.title, "up", u.id)} aria-label={`Move unit ${u.title} up`}>Up</button>
              <button type="button" id={`down-unit-${u.id}`} className="btn small secondary" disabled={ui === course.units.length - 1} onClick={() => move("unit", u.id, u.title, "down", u.id)} aria-label={`Move unit ${u.title} down`}>Down</button>
              <button type="button" className="btn small danger" onClick={() => remove("unit", u.id, u.title, "new-unit", u.id, u.topics.length ? ` Its ${u.topics.length} topic${u.topics.length === 1 ? "" : "s"} will be deleted too.` : "")} aria-label={`Delete unit ${u.title}`}>Delete</button>
            </div>
          </div>
          {u.topics.length === 0 ? (
            <p className="small muted">No topics yet.</p>
          ) : (
            <ul className="structure">
              {u.topics.map((t, ti) => (
                <li key={t.id}>
                  <span>
                    {t.title} <span className="small muted">· {t.questionCount} question{t.questionCount === 1 ? "" : "s"}</span>
                  </span>
                  <span className="row">
                    <button type="button" className="btn small secondary" onClick={() => rename("topic", t.id, t.title, u.id)} aria-label={`Rename topic ${t.title}`}>Rename</button>
                    <button type="button" id={`up-topic-${t.id}`} className="btn small secondary" disabled={ti === 0} onClick={() => move("topic", t.id, t.title, "up", u.id)} aria-label={`Move topic ${t.title} up`}>Up</button>
                    <button type="button" id={`down-topic-${t.id}`} className="btn small secondary" disabled={ti === u.topics.length - 1} onClick={() => move("topic", t.id, t.title, "down", u.id)} aria-label={`Move topic ${t.title} down`}>Down</button>
                    <button type="button" className="btn small danger" disabled={t.questionCount > 0} title={t.questionCount > 0 ? "Topics with questions cannot be deleted" : undefined} onClick={() => remove("topic", t.id, t.title, `nt-${u.id}`, u.id)} aria-label={`Delete topic ${t.title}`}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form className="inline-form" onSubmit={(e) => addTopic(e, u.id)}>
            <label htmlFor={`nt-${u.id}`} className="sr-only">New topic in {u.title}</label>
            <input id={`nt-${u.id}`} type="text" required maxLength={160} placeholder="New topic" value={newTopics[u.id] ?? ""} onChange={(e) => setNewTopics({ ...newTopics, [u.id]: e.target.value })} />
            <button className="btn small secondary">Add topic</button>
          </form>
          {errorIn(u.id)}
        </section>
      ))}
      <form className="inline-form" style={{ marginTop: "1rem" }} onSubmit={addUnit}>
        <label htmlFor="new-unit" className="sr-only">New unit</label>
        <input id="new-unit" type="text" required maxLength={120} placeholder="New unit" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
        <button className="btn secondary">Add unit</button>
      </form>
      {errorIn("new-unit")}
      <p role="status" className="small muted">{status}</p>
    </div>
  );
}

export function OutlineImport({ courseId }: { courseId: string }) {
  const { error, status, busy, run } = useAction();
  const [text, setText] = useState("");
  return (
    <form
      className="card"
      aria-label="Add units and topics from an outline"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(
          () => api<{ units: number; topics: number }>("POST", `/api/moderation/courses/${courseId}/outline`, { text }),
          (r) => `Added ${r.units} unit${r.units === 1 ? "" : "s"} and ${r.topics} topic${r.topics === 1 ? "" : "s"}.`,
        );
        if (ok) setText("");
      }}
    >
      <label htmlFor="oi-text" style={{ marginTop: 0 }}>Outline <span className="help" id="oi-help">{OUTLINE_HELP} The new units are added after the existing ones; a unit title that already exists is refused and nothing is added.</span></label>
      <textarea id="oi-text" required maxLength={10000} aria-describedby="oi-help" placeholder={OUTLINE_EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} />
      {error && <p role="alert" className="field-error">{error}</p>}
      <p style={{ marginBottom: 0 }}>
        <button className="btn secondary" disabled={busy || !text.trim()}>Add to course</button>
        <span role="status" className="small muted" style={{ marginLeft: "0.8rem" }}>{status}</span>
      </p>
    </form>
  );
}

/** Dismiss / reopen buttons for a row of the course-requests table. */
export function RequestActions({ id, status }: { id: string; status: "open" | "dismissed" }) {
  const { error, run } = useAction();
  return (
    <span>
      <button
        type="button"
        className="btn small secondary"
        onClick={() => run(() => api("PATCH", `/api/moderation/course-requests/${id}`, { status: status === "open" ? "dismissed" : "open" }), "")}
      >
        {status === "open" ? "Dismiss" : "Reopen"}
      </button>
      {error && <span role="alert" className="field-error"> {error}</span>}
    </span>
  );
}
