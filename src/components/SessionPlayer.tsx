"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { updateHistory } from "@/lib/guest-history";
import { Markdown } from "./Markdown";
import { QuestionMeta } from "./QuestionMeta";
import { ReportButton } from "./ReportButton";
import { BookmarkButton } from "./BookmarkButton";
import { Dialog } from "./Dialog";
import type { SessionItem, Results } from "@/lib/services/practice";

type State = {
  id: string;
  mode: "practice" | "self_test";
  state: "in_progress" | "finished" | "abandoned";
  deadline: string | null;
  requested: number;
  items: SessionItem[];
  results: Results | null;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function SessionPlayer({ sessionId, signedIn, bookmarked }: { sessionId: string; signedIn: boolean; bookmarked: string[] }) {
  const router = useRouter();
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "abandon" | "finish">(null);
  const [announce, setAnnounce] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api<State>("GET", `/api/sessions/${sessionId}`);
      setData(d);
      if (!positioned.current) {
        positioned.current = true;
        const first = d.items.findIndex((i) => i.status === "available" && !i.answer);
        setIdx(first >= 0 ? first : 0);
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "This session could not be found. It may belong to another device or account, or it was deleted." : (e as Error).message);
    }
  }, [sessionId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
  useEffect(() => { load(); }, [load]);

  // Warn before leaving an unfinished session via browser navigation. Progress is saved on the server either way.
  useEffect(() => {
    if (data?.state !== "in_progress") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [data?.state]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api<Results>("POST", `/api/sessions/${sessionId}/finish`);
      updateHistory(sessionId, { finished: true, correct: r.correct, total: r.total });
      await load();
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }, [sessionId, load]);

  // Optional timer.
  useEffect(() => {
    if (!data?.deadline || data.state !== "in_progress") return;
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(data.deadline!) - Date.now()) / 1000));
      setRemaining(s);
      if (s === 0) finish();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [data?.deadline, data?.state, finish]);

  if (error) return <div className="notice bad" role="alert">{error} <Link href="/">Back to courses</Link></div>;
  if (!data) return <p role="status">Loading your session…</p>;
  if (data.state === "abandoned") return <div className="notice">This session was abandoned. <Link href="/">Start a new one</Link>.</div>;
  if (data.state === "finished" && data.results) {
    return <ResultsView data={data} signedIn={signedIn} bookmarked={new Set(bookmarked)} />;
  }

  const items = data.items;
  const item = items[idx];
  const answered = items.filter((i) => i.answer?.selectedOptionId).length;
  const unavailable = items.filter((i) => i.status === "unavailable").length;
  const total = items.length;
  const selfTest = data.mode === "self_test";

  async function submitAnswer(it: SessionItem, optionId: string) {
    setBusy(true);
    try {
      await api("POST", `/api/sessions/${sessionId}/answer`, { sessionQuestionId: it.id, optionId });
      await load();
      setAnnounce(selfTest ? "Answer saved." : "Answer submitted. Feedback is shown below.");
      if (!selfTest) setTimeout(() => feedbackRef.current?.focus(), 50);
    } catch (e) {
      handleErr(e);
    } finally {
      setBusy(false);
    }
  }
  function handleErr(e: unknown) {
    if (e instanceof ApiError && (e.code === "unavailable" || e.code === "time_up")) {
      setAnnounce(e.message);
      load();
    } else setError((e as Error).message);
  }
  async function skip(it: SessionItem) {
    try {
      await api("POST", `/api/sessions/${sessionId}/answer`, { sessionQuestionId: it.id, skip: true });
      await load();
      setAnnounce("Question skipped. You can return to it from the question list.");
      if (idx < total - 1) setIdx(idx + 1);
    } catch (e) {
      handleErr(e);
    }
  }
  const go = (n: number) => { setIdx(n); setAnnounce(`Question ${n + 1} of ${total}`); };

  return (
    <div>
      <div className="row space">
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>{selfTest ? "Self-test" : "Practice"}</h1>
        {remaining !== null && <p role="timer" aria-live="off" className="badge" style={{ fontSize: "1rem" }}>Time left: {fmt(remaining)}</p>}
      </div>
      {data.requested > total && (
        <p className="notice" role="note">You asked for {data.requested} questions but only {total} matched, so this session has {total}. Questions are never repeated to fill a session.</p>
      )}
      <p className="small" id="progress-label">Question {idx + 1} of {total} · {answered} answered{unavailable ? ` · ${unavailable} unavailable` : ""}</p>
      <div className="progress" role="progressbar" aria-labelledby="progress-label" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <span style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
      </div>

      <ul className="qnav" aria-label="Questions">
        {items.map((it, i) => {
          const st = it.status === "unavailable" ? "unavailable" : it.answer?.selectedOptionId ? "answered" : it.answer?.skipped ? "skipped" : "not answered";
          return (
            <li key={it.id}>
              <button className={st === "answered" ? "done" : ""} aria-current={i === idx ? "step" : undefined} aria-label={`Question ${i + 1}, ${st}`} onClick={() => go(i)}>{i + 1}</button>
            </li>
          );
        })}
      </ul>

      <div className="sr-only" role="status" aria-live="polite">{announce}</div>

      {item.status === "unavailable" || !item.question ? (
        <div className="notice warn" role="alert">This question is no longer available and is excluded from your score.</div>
      ) : (
        <QuestionCard
          key={item.id}
          item={item}
          selfTest={selfTest}
          choice={choice[item.id] ?? item.answer?.selectedOptionId ?? ""}
          onChoose={(o) => {
            setChoice((c) => ({ ...c, [item.id]: o }));
            if (selfTest) submitAnswer(item, o);
          }}
          onCheck={() => submitAnswer(item, choice[item.id])}
          busy={busy}
          feedbackRef={feedbackRef}
          signedIn={signedIn}
          bookmarked={bookmarked.includes(item.question.questionId)}
        />
      )}

      <div className="row" style={{ marginTop: "1rem" }}>
        <button className="btn secondary" disabled={idx === 0} onClick={() => go(idx - 1)}>Previous</button>
        {item.status === "available" && !item.reveal && (
          <button className="btn secondary" onClick={() => skip(item)}>Skip</button>
        )}
        <button className="btn secondary" disabled={idx >= total - 1} onClick={() => go(idx + 1)}>Next</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setDialog("finish")}>Finish session</button>
        <button className="btn secondary" onClick={() => setDialog("abandon")}>Abandon</button>
      </div>
      <p className="small muted">Your answers are saved as you go{signedIn ? "" : " (on this device; guest sessions are listed under Saved & history)"}. You can leave and resume later.</p>

      <Dialog open={dialog === "finish"} onClose={() => setDialog(null)} title="Finish this session?">
        <p>{total - answered - unavailable > 0 ? `You have ${total - answered - unavailable} unanswered question(s). They will count as skipped.` : "All questions are answered."}</p>
        <div className="row"><button className="btn" disabled={busy} onClick={finish}>See results</button><button className="btn secondary" onClick={() => setDialog(null)}>Keep practising</button></div>
      </Dialog>
      <Dialog open={dialog === "abandon"} onClose={() => setDialog(null)} title="Abandon this session?">
        <p>Your answers will be discarded and no results will be shown. This cannot be undone.</p>
        <div className="row">
          <button className="btn danger" onClick={async () => { await api("POST", `/api/sessions/${sessionId}/abandon`); router.push("/"); }}>Abandon session</button>
          <button className="btn secondary" onClick={() => setDialog(null)}>Keep practising</button>
        </div>
      </Dialog>
    </div>
  );
}

export function OptionList({ item, choice, onChoose, locked, showReveal }: { item: SessionItem; choice: string; onChoose?: (id: string) => void; locked: boolean; showReveal: boolean }) {
  const q = item.question!;
  const rv = item.reveal;
  return (
    <div className="options" role={locked ? "group" : "radiogroup"} aria-label="Answer options">
      {q.options.map((o, i) => {
        const isCorrect = showReveal && rv?.correctOptionId === o.id;
        const isChosen = (item.answer?.selectedOptionId ?? choice) === o.id;
        const isWrongChoice = showReveal && isChosen && !isCorrect;
        const cls = isCorrect ? "correct" : isWrongChoice ? "incorrect" : isChosen ? "selected" : "";
        const id = `${item.id}-${o.id}`;
        return (
          <div key={o.id} className={`option ${cls}`}>
            <input type="radio" id={id} name={`q-${item.id}`} checked={isChosen} disabled={locked} onChange={() => onChoose?.(o.id)} />
            <label htmlFor={id}>
              <span className="sr-only">Option {i + 1}. </span>
              {isCorrect && <span className="status-tag">✓ Correct answer{isChosen ? " (your answer)" : ""}.</span>}
              {isWrongChoice && <span className="status-tag">✗ Your answer (incorrect).</span>}
              {!showReveal && isChosen && locked && <span className="status-tag">Your answer.</span>}
              <Markdown>{o.text}</Markdown>
              {showReveal && rv?.explanations[o.id] && <div className="explain"><b>{isCorrect ? "Why this is correct: " : "Why not: "}</b><Markdown>{rv.explanations[o.id]}</Markdown></div>}
            </label>
          </div>
        );
      })}
    </div>
  );
}

function QuestionCard({ item, selfTest, choice, onChoose, onCheck, busy, feedbackRef, signedIn, bookmarked }: {
  item: SessionItem;
  selfTest: boolean;
  choice: string;
  onChoose: (id: string) => void;
  onCheck: () => void;
  busy: boolean;
  feedbackRef: React.RefObject<HTMLDivElement | null>;
  signedIn: boolean;
  bookmarked: boolean;
}) {
  const q = item.question!;
  const revealed = !!item.reveal;
  return (
    <article className="card" aria-labelledby={`stem-${item.id}`}>
      <QuestionMeta {...q} />
      <div id={`stem-${item.id}`} style={{ margin: "0.8rem 0" }}><Markdown>{q.stem}</Markdown></div>
      <OptionList item={item} choice={choice} onChoose={onChoose} locked={revealed} showReveal={revealed} />
      {!selfTest && !revealed && (
        <button className="btn" disabled={!choice || busy} onClick={onCheck}>Check answer</button>
      )}
      {selfTest && item.answer?.selectedOptionId && <p className="small muted" role="status">Answer saved. You can change it until you finish.</p>}
      {revealed && (
        <div ref={feedbackRef} tabIndex={-1} className={`notice ${item.reveal!.isCorrect ? "good" : "bad"}`} aria-label="Feedback">
          <b>{item.reveal!.isCorrect === null ? "Skipped." : item.reveal!.isCorrect ? "✓ Correct." : "✗ Incorrect."}</b>{" "}
          <span className="small">Objective: {item.reveal!.learningObjective}</span>
          <p className="small" style={{ marginBottom: 0 }}>How the contributor checked: {item.reveal!.checkDescription}</p>
          {item.reveal!.referenceText && <p className="small" style={{ marginBottom: 0 }}>Reference: {item.reveal!.referenceText}{item.reveal!.referenceUrl && <> — <a href={item.reveal!.referenceUrl} target="_blank" rel="noopener noreferrer nofollow ugc">link</a> <span className="muted">(not checked by OpenFrame)</span></>}</p>}
        </div>
      )}
      <div className="row" style={{ marginTop: "0.6rem" }}>
        <ReportButton questionId={q.questionId} />
        <BookmarkButton questionId={q.questionId} initial={bookmarked} signedIn={signedIn} />
      </div>
    </article>
  );
}

function ResultsView({ data, signedIn, bookmarked }: { data: State; signedIn: boolean; bookmarked: Set<string> }) {
  const router = useRouter();
  const r = data.results!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
  const retry = async () => {
    setBusy(true);
    try {
      const s = await api<{ id: string }>("POST", "/api/sessions", { retryFrom: data.id, count: 50, mode: data.mode, includeUnreviewed: true });
      router.push(`/practice/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const hasKey = useMemo(() => data.items.some((i) => i.reveal), [data.items]);
  return (
    <div>
      <h1>Results</h1>
      <p className="muted">{r.total ? `${r.correct} of ${r.total} correct (${pct}%).` : "No scored questions."} This is a practice result, not a prediction of exam performance.</p>
      <div className="stats" role="list">
        <div className="stat" role="listitem"><b>{r.answered}</b>Answered</div>
        <div className="stat" role="listitem"><b>{r.correct}</b>Correct</div>
        <div className="stat" role="listitem"><b>{r.incorrect}</b>Incorrect</div>
        <div className="stat" role="listitem"><b>{r.skipped}</b>Skipped</div>
      </div>
      {r.unavailable > 0 && <p className="notice warn" role="note">{r.unavailable} question(s) were withdrawn after your session started and are excluded from scoring.</p>}

      <h2>By topic</h2>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Results by topic">
        <table>
          <caption className="sr-only">Results by topic with sample sizes</caption>
          <thead><tr><th scope="col">Topic</th><th scope="col">Correct</th><th scope="col">Answered</th><th scope="col">Questions in session</th></tr></thead>
          <tbody>{r.byTopic.map((t) => <tr key={t.topic}><th scope="row">{t.topic}</th><td>{t.correct}</td><td>{t.answered}</td><td>{t.total}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="small muted">Topic figures come from very few questions; treat them as a rough guide, not a measure of mastery.</p>

      <div className="row" style={{ margin: "1rem 0" }}>
        {r.missed.length > 0 && <button className="btn" disabled={busy} onClick={retry}>Retry {r.missed.length} missed question{r.missed.length === 1 ? "" : "s"}</button>}
        <Link className="btn secondary" href="/">Choose another course</Link>
        <Link className="btn secondary" href="/saved">Saved &amp; history</Link>
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}
      {!signedIn && <p className="small muted">This result is stored on this device only. <Link href="/auth/sign-in">Sign in</Link> to keep history across devices.</p>}

      <h2>Question review</h2>
      {data.items.map((it, i) => (
        <article key={it.id} className="card" aria-label={`Question ${i + 1}`}>
          {it.status === "unavailable" || !it.question ? (
            <p className="muted">Question {i + 1} is no longer available and was excluded from scoring.</p>
          ) : (
            <>
              <p className="label" style={{ marginTop: 0 }}>Question {i + 1} — {it.reveal?.isCorrect === null ? "skipped" : it.reveal?.isCorrect ? "✓ correct" : "✗ incorrect"}</p>
              <QuestionMeta {...it.question} />
              <div style={{ margin: "0.6rem 0" }}><Markdown>{it.question.stem}</Markdown></div>
              <OptionList item={it} choice="" locked showReveal={hasKey} />
              <div className="row">
                <ReportButton questionId={it.question.questionId} />
                <BookmarkButton questionId={it.question.questionId} initial={bookmarked.has(it.question.questionId)} signedIn={signedIn} />
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
