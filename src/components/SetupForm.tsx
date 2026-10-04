"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { addHistory } from "@/lib/guest-history";
import { FIRST_PRACTICE_NOTICE, INCLUDE_UNVERIFIED_HELP } from "@/lib/copy";

type Topic = { id: string; title: string; verifiedCount: number; unverifiedCount: number };
type Unit = { id: string; title: string; topics: Topic[] };
const ACK_KEY = "openframe.ack.practice-notice";

export function SetupForm({ course, units, defaultUnverified }: { course: { id: string; code: string; title: string; slug: string }; units: Unit[]; defaultUnverified: boolean }) {
  const router = useRouter();
  const allTopics = useMemo(() => units.flatMap((u) => u.topics), [units]);
  const [selected, setSelected] = useState<Set<string>>(new Set(allTopics.map((t) => t.id)));
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("");
  const [mode, setMode] = useState<"practice" | "self_test">("practice");
  // Verified questions only, unless the learner opts in.
  const [includeUnverified, setIncludeUnverified] = useState(defaultUnverified);
  const [timer, setTimer] = useState(false);
  const [minutes, setMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(true);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage, which only exists in the browser
      setAck(localStorage.getItem(ACK_KEY) === "1");
    } catch {
      setAck(false);
    }
  }, []);

  const countOf = (t: Topic) => t.verifiedCount + (includeUnverified ? t.unverifiedCount : 0);
  const available = allTopics.filter((t) => selected.has(t.id)).reduce((n, t) => n + countOf(t), 0);
  const hiddenUnverified = allTopics.filter((t) => selected.has(t.id)).reduce((n, t) => n + (includeUnverified ? 0 : t.unverifiedCount), 0);
  const effective = Math.min(count, available);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ id: string; total: number }>("POST", "/api/sessions", {
        courseId: course.id,
        topicIds: [...selected],
        count,
        difficulty: difficulty || null,
        mode,
        includeUnverified,
        timerMinutes: timer ? minutes : null,
      });
      addHistory({ id: r.id, courseCode: course.code, courseTitle: course.title, mode, createdAt: new Date().toISOString(), total: r.total });
      router.push(`/practice/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={start}>
      {!ack && (
        <div className="notice warn" role="note">
          <p style={{ margin: 0 }}>{FIRST_PRACTICE_NOTICE}</p>
          <button type="button" className="btn small secondary" style={{ marginTop: "0.5rem" }} onClick={() => { try { localStorage.setItem(ACK_KEY, "1"); } catch {} setAck(true); }}>Got it</button>
        </div>
      )}
      <fieldset>
        <legend>Topics</legend>
        {units.map((u) => (
          <div key={u.id}>
            <p className="label" style={{ marginBottom: 0 }}>{u.title}</p>
            {u.topics.map((t) => {
              const n = countOf(t);
              return (
                <label key={t.id} className="check">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                  <span>{t.title} <span className="muted">({t.verifiedCount} verified{includeUnverified ? `, ${t.unverifiedCount} unverified` : ""}{n === 0 && !includeUnverified && t.unverifiedCount > 0 ? "; none verified yet" : ""})</span></span>
                </label>
              );
            })}
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>Questions</legend>
        <div className="row" role="group" aria-label="Number of questions">
          {[5, 10, 20].map((n) => (
            <button key={n} type="button" className={`btn ${count === n ? "" : "secondary"}`} aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>
          ))}
        </div>
        <label className="check" style={{ marginTop: "0.8rem" }}>
          <input type="checkbox" checked={includeUnverified} onChange={(e) => setIncludeUnverified(e.target.checked)} aria-describedby="unverified-help" />
          <span>Include unverified questions <span className="help" id="unverified-help">{INCLUDE_UNVERIFIED_HELP} Off by default: only verified questions are used.</span></span>
        </label>
        <label htmlFor="diff">Difficulty <span className="help">Contributor-assigned suggestions, not validated.</span></label>
        <select id="diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">Any</option>
          <option value="introductory">Introductory</option>
          <option value="intermediate">Intermediate</option>
          <option value="challenging">Challenging</option>
        </select>
        <p role="status" className={available === 0 ? "field-error" : "muted"}>
          {available === 0
            ? hiddenUnverified > 0
              ? `No verified questions are available for these topics yet. ${hiddenUnverified} unverified question${hiddenUnverified === 1 ? " is" : "s are"} available if you choose “Include unverified questions”.`
              : "No questions match these settings."
            : effective < count
              ? `Only ${available} question${available === 1 ? " is" : "s are"} available for these topics; your session will have ${effective}. Questions are never repeated to fill a session.`
              : `Up to ${effective} ${includeUnverified ? "" : "verified "}questions from ${available} available (difficulty filter may reduce this).`}
        </p>
      </fieldset>

      <fieldset>
        <legend>Mode</legend>
        <label className="check"><input type="radio" name="mode" checked={mode === "practice"} onChange={() => setMode("practice")} />
          <span><b>Practice</b> – see whether you were right, with explanations, after each answer.</span></label>
        <label className="check"><input type="radio" name="mode" checked={mode === "self_test"} onChange={() => setMode("self_test")} />
          <span><b>Self-test</b> – answers and explanations are shown after you finish. This is not a simulation of a university exam.</span></label>
        <label className="check" style={{ marginTop: "0.8rem" }}>
          <input type="checkbox" checked={timer} onChange={(e) => setTimer(e.target.checked)} />
          <span>Add an optional timer</span>
        </label>
        {timer && (
          <>
            <label htmlFor="mins">Minutes</label>
            <input id="mins" type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ maxWidth: "8rem" }} />
          </>
        )}
      </fieldset>

      {error && <p role="alert" className="field-error">{error}</p>}
      <button className="btn" disabled={busy || available === 0 || selected.size === 0}>{busy ? "Starting…" : `Start ${effective || ""} question${effective === 1 ? "" : "s"}`.replace("  ", " ")}</button>
      <p className="small muted">Guests: your progress is kept on this device only. <a href="/auth/sign-in">Sign in</a> to save history across devices.</p>
    </form>
  );
}
