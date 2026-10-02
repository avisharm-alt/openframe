"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { Markdown } from "./Markdown";
import { QuestionMeta } from "./QuestionMeta";
import { OptionList } from "./SessionPlayer";
import { Dialog } from "./Dialog";
import { ATTESTATION_TEXT } from "@/lib/attestation";
import { STRUCTURAL_CHECK_NOTE } from "@/lib/copy";
import type { SessionItem } from "@/lib/services/practice";

type Target = { id: string; code: string; title: string; isDemo: boolean; topics: { id: string; title: string; unit: string }[] };
type Opt = { id: string; text: string; explanation: string };
export type Draft = {
  courseId: string; topicId: string; stem: string; learningObjective: string; options: Opt[]; correctOptionId?: string | null;
  difficulty?: string | null; contextTag?: string; aiProvenance?: string | null; aiTool?: string; aiGeneratedOn?: string;
  checkDescription: string; referenceText?: string; referenceUrl?: string; publicAttribution?: boolean;
};
type Issue = { field: string; message: string };

const newOpt = (): Opt => ({ id: crypto.randomUUID(), text: "", explanation: "" });

export function ContributionEditor({ targets, initial, isMaintainer = false }: { targets: Target[]; initial: null | { id: string; draft: Draft; revisionNumber: number; hasLive: boolean; requestedChanges: string | null }; isMaintainer?: boolean }) {
  const router = useRouter();
  const d0 = initial?.draft;
  const [courseId, setCourseId] = useState(d0?.courseId ?? targets[0]?.id ?? "");
  const [topicId, setTopicId] = useState(d0?.topicId ?? "");
  const [stem, setStem] = useState(d0?.stem ?? "");
  const [objective, setObjective] = useState(d0?.learningObjective ?? "");
  const [options, setOptions] = useState<Opt[]>(d0?.options?.length ? d0.options : [newOpt(), newOpt(), newOpt(), newOpt()]);
  const [correct, setCorrect] = useState<string | null>(d0?.correctOptionId ?? null);
  const [difficulty, setDifficulty] = useState(d0?.difficulty ?? "");
  const [prov, setProv] = useState(d0?.aiProvenance ?? "");
  const [tool, setTool] = useState(d0?.aiTool ?? "");
  const [genOn, setGenOn] = useState(d0?.aiGeneratedOn ?? "");
  const [check, setCheck] = useState(d0?.checkDescription ?? "");
  const [refText, setRefText] = useState(d0?.referenceText ?? "");
  const [refUrl, setRefUrl] = useState(d0?.referenceUrl ?? "");
  const [attrib, setAttrib] = useState(d0?.publicAttribution ?? false);
  const [attested, setAttested] = useState(false);
  const [qid, setQid] = useState<string | null>(initial?.id ?? null);
  const [errors, setErrors] = useState<Issue[]>([]);
  const [warnings, setWarnings] = useState<Issue[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dlg, setDlg] = useState<null | "delete" | "publish">(null);

  const course = targets.find((t) => t.id === courseId);
  const topics = useMemo(() => course?.topics ?? [], [course]);
  const effectiveTopic = topics.some((t) => t.id === topicId) ? topicId : topics[0]?.id ?? "";
  const err = (f: string) => errors.find((e) => e.field === f)?.message;
  const body = () => ({
    courseId, topicId: effectiveTopic, stem, learningObjective: objective, options,
    correctOptionId: correct && options.some((o) => o.id === correct) ? correct : null,
    difficulty: difficulty || null, aiProvenance: prov || null, aiTool: tool, aiGeneratedOn: genOn,
    checkDescription: check, referenceText: refText, referenceUrl: refUrl, publicAttribution: attrib,
  });

  async function save(): Promise<string | null> {
    setErrors([]); setMsg(null);
    try {
      if (!qid) {
        const r = await api<{ id: string }>("POST", "/api/contributions", body());
        setQid(r.id);
        router.replace(`/contribute/${r.id}`);
        setMsg("Draft saved.");
        return r.id;
      }
      const r = await api<{ checks: { errors: Issue[]; warnings: Issue[] } }>("PUT", `/api/contributions/${qid}`, body());
      setWarnings(r.checks.warnings);
      setMsg("Draft saved.");
      return qid;
    } catch (e) {
      showError(e);
      return null;
    }
  }
  function showError(e: unknown) {
    if (e instanceof ApiError) {
      const det = e.details as { errors?: Issue[]; warnings?: Issue[] } | { path: string; message: string }[] | undefined;
      if (Array.isArray(det)) setErrors(det.map((x) => ({ field: x.path, message: x.message })));
      else if (det?.errors) { setErrors(det.errors); setWarnings(det.warnings ?? []); }
      setMsg(null);
      setErrors((cur) => (cur.length ? cur : [{ field: "form", message: e.message }]));
    } else setErrors([{ field: "form", message: (e as Error).message }]);
  }
  async function submit() {
    setBusy(true);
    try {
      const id = await save();
      if (!id) return;
      await api("POST", `/api/contributions/${id}/submit`, { attested: true });
      router.push("/contribute");
      router.refresh();
    } catch (e) { showError(e); } finally { setBusy(false); }
  }

  /** Maintainers only: publish immediately, labelled Unreviewed. The server enforces the role. */
  async function publishNow() {
    setBusy(true);
    try {
      const id = await save();
      if (!id) { setDlg(null); return; }
      await api("POST", `/api/contributions/${id}/publish`, { attested: true });
      router.push("/contribute");
      router.refresh();
    } catch (e) { setDlg(null); showError(e); } finally { setBusy(false); }
  }
  async function deleteDraft() {
    if (!qid) return;
    setBusy(true);
    try {
      await api("DELETE", `/api/contributions/${qid}`);
      router.push("/contribute");
      router.refresh();
    } catch (e) { setDlg(null); showError(e); } finally { setBusy(false); }
  }

  const previewItem: SessionItem = useMemo(() => ({
    id: "preview", position: 0, status: "available", answer: null,
    question: { stem: stem || "(stem)", options: options.map((o) => ({ id: o.id, text: o.text || "(option)" })), difficulty: difficulty || null, aiProvenance: prov || null, aiTool: tool || null, aiGeneratedOn: genOn || null, reviewStatus: "unreviewed", reviewedAt: null, isDemo: false, topic: topics.find((t) => t.id === effectiveTopic)?.title ?? "", courseCode: course?.code ?? "", questionId: "preview" },
    reveal: { correctOptionId: correct, isCorrect: null, explanations: Object.fromEntries(options.map((o) => [o.id, o.explanation || "(explanation)"])), learningObjective: objective, checkDescription: check, referenceText: refText || null, referenceUrl: refUrl || null },
  }), [stem, options, difficulty, prov, tool, genOn, correct, objective, check, refText, refUrl, effectiveTopic, topics, course]);

  const setOpt = (i: number, patch: Partial<Opt>) => setOptions((o) => o.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="two">
      <form onSubmit={(e) => { e.preventDefault(); save(); }} aria-label="Question editor" noValidate>
        {initial?.requestedChanges && <div className="notice warn" role="note"><b>A reviewer requested changes:</b> {initial.requestedChanges}</div>}
        {initial?.hasLive && <div className="notice" role="note">You are editing revision {initial.revisionNumber}. The currently published version stays live until this revision is reviewed.</div>}
        {errors.length > 0 && (
          <div className="notice bad" role="alert" tabIndex={-1}>
            <b>Please fix:</b>
            <ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </div>
        )}
        {msg && <p role="status" className="notice good">{msg}</p>}

        <fieldset>
          <legend>Where does it belong?</legend>
          <label htmlFor="course">Course</label>
          <select id="course" value={courseId} disabled={!!initial?.hasLive} onChange={(e) => { setCourseId(e.target.value); setTopicId(""); }}>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.title}</option>)}
          </select>
          <label htmlFor="topic">Unit / topic</label>
          <select id="topic" value={effectiveTopic} onChange={(e) => setTopicId(e.target.value)}>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.unit} › {t.title}</option>)}
          </select>
          <label htmlFor="objective">Learning objective <span className="help">What specific skill or idea does this question test?</span></label>
          <input id="objective" type="text" value={objective} maxLength={300} onChange={(e) => setObjective(e.target.value)} aria-invalid={!!err("learningObjective")} />
          {err("learningObjective") && <p className="field-error">{err("learningObjective")}</p>}
        </fieldset>

        <fieldset>
          <legend>Question</legend>
          <label htmlFor="stem">Question stem <span className="help">Original wording only. Markdown and LaTeX ($x^2$) are supported; HTML and images are not.</span></label>
          <textarea id="stem" value={stem} maxLength={3000} onChange={(e) => setStem(e.target.value)} aria-invalid={!!err("stem")} />
          {err("stem") && <p className="field-error">{err("stem")}</p>}
        </fieldset>

        <fieldset>
          <legend>Answer options (4 or 5)</legend>
          <p className="help">Choose exactly one correct answer. Every option needs its own explanation. Avoid “all/none of the above” and references to option letters; options are shuffled.</p>
          {err("options") && <p className="field-error">{err("options")}</p>}
          {err("correctOptionId") && <p className="field-error">{err("correctOptionId")}</p>}
          {options.map((o, i) => (
            <div key={o.id} className="card" role="group" aria-label={`Option ${i + 1}`}>
              <label className="check" style={{ marginTop: 0 }}>
                <input type="radio" name="correct" checked={correct === o.id} onChange={() => setCorrect(o.id)} />
                <span><b>Option {i + 1}</b> — mark as correct answer</span>
              </label>
              <label htmlFor={`ot-${i}`}>Text</label>
              <textarea id={`ot-${i}`} style={{ minHeight: "3.5rem" }} value={o.text} maxLength={500} onChange={(e) => setOpt(i, { text: e.target.value })} aria-invalid={!!err(`options.${i}.text`)} />
              {err(`options.${i}.text`) && <p className="field-error">{err(`options.${i}.text`)}</p>}
              <label htmlFor={`oe-${i}`}>Explanation <span className="help">{correct === o.id ? "Why this is correct." : "Why this is not correct (the misconception it targets)."}</span></label>
              <textarea id={`oe-${i}`} style={{ minHeight: "3.5rem" }} value={o.explanation} maxLength={2000} onChange={(e) => setOpt(i, { explanation: e.target.value })} aria-invalid={!!err(`options.${i}.explanation`)} />
              {err(`options.${i}.explanation`) && <p className="field-error">{err(`options.${i}.explanation`)}</p>}
              {options.length > 4 && <button type="button" className="link-btn small" onClick={() => { setOptions(options.filter((x) => x.id !== o.id)); if (correct === o.id) setCorrect(null); }}>Remove option {i + 1}</button>}
            </div>
          ))}
          {options.length < 5 && <button type="button" className="btn secondary small" onClick={() => setOptions([...options, newOpt()])}>Add a fifth option</button>}
        </fieldset>

        <fieldset>
          <legend>Provenance and checking</legend>
          <label htmlFor="difficulty">Suggested difficulty <span className="help">Your suggestion; it is shown as contributor-assigned and is not validated.</span></label>
          <select id="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-invalid={!!err("difficulty")}>
            <option value="">Choose…</option><option value="introductory">Introductory</option><option value="intermediate">Intermediate</option><option value="challenging">Challenging</option>
          </select>
          {err("difficulty") && <p className="field-error">{err("difficulty")}</p>}
          <p className="label">How was this question made?</p>
          <label className="check"><input type="radio" name="prov" checked={prov === "ai_generated"} onChange={() => setProv("ai_generated")} /><span>AI-generated (AI wrote it; I checked it)</span></label>
          <label className="check"><input type="radio" name="prov" checked={prov === "ai_assisted"} onChange={() => setProv("ai_assisted")} /><span>AI-assisted (I wrote or heavily edited it with AI help)</span></label>
          {err("aiProvenance") && <p className="field-error">{err("aiProvenance")}</p>}
          <label htmlFor="tool">AI tool / model <span className="help">Optional. Only enter what you actually used; leave blank if unsure.</span></label>
          <input id="tool" type="text" value={tool} maxLength={100} onChange={(e) => setTool(e.target.value)} />
          <label htmlFor="genon">Generation date <span className="help">Optional.</span></label>
          <input id="genon" type="date" value={genOn} onChange={(e) => setGenOn(e.target.value)} />
          <label htmlFor="check">How did you check that the answer is correct?</label>
          <textarea id="check" style={{ minHeight: "4rem" }} value={check} maxLength={1000} onChange={(e) => setCheck(e.target.value)} aria-invalid={!!err("checkDescription")} />
          {err("checkDescription") && <p className="field-error">{err("checkDescription")}</p>}
          <label htmlFor="reftext">Reference title or citation <span className="help">Optional. Only cite material you are permitted to share. Do not paste copyrighted text.</span></label>
          <input id="reftext" type="text" value={refText} maxLength={500} onChange={(e) => setRefText(e.target.value)} />
          <label htmlFor="refurl">Reference link <span className="help">Optional. OpenFrame never fetches or verifies links.</span></label>
          <input id="refurl" type="url" value={refUrl} maxLength={500} onChange={(e) => setRefUrl(e.target.value)} />
          {err("referenceUrl") && <p className="field-error">{err("referenceUrl")}</p>}
          <label className="check"><input type="checkbox" checked={attrib} onChange={(e) => setAttrib(e.target.checked)} /><span>Show my display name as the contributor on this question <span className="help">Off by default. Your display name can be a pseudonym.</span></span></label>
        </fieldset>

        {warnings.length > 0 && (
          <div className="notice warn" role="status"><b>Suggestions (not blocking):</b><ul>{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></div>
        )}
        <p className="small muted">{STRUCTURAL_CHECK_NOTE}</p>

        <fieldset>
          <legend>Before you submit</legend>
          <label className="check"><input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} /><span>{ATTESTATION_TEXT}</span></label>
          <p className="small muted">Never include professor-created exam, quiz or test content, answer keys, or questions you remember from real assessments, even reworded.</p>
        </fieldset>

        <div className="row">
          <button className="btn secondary" disabled={busy}>Save draft</button>
          <button type="button" className="btn" disabled={busy || !attested} onClick={submit}>{busy ? "Submitting…" : "Submit for review"}</button>
          <button type="button" className="btn secondary" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Show preview"}</button>
          {isMaintainer && <button type="button" className="btn secondary" disabled={busy || !attested} onClick={() => setDlg("publish")}>Publish without review</button>}
          {qid && <button type="button" className="btn danger" disabled={busy} onClick={() => setDlg("delete")}>Delete</button>}
        </div>
        <p className="small muted">Submitting sends this for review by another student. It is never published immediately.{isMaintainer && " As a maintainer you can instead publish without review; it is then labelled Unreviewed and the audit log records that review was skipped."}</p>
      </form>

      <Dialog open={dlg !== null} onClose={() => setDlg(null)} title={dlg === "publish" ? "Publish without review?" : "Delete this question?"}>
        {dlg === "publish" ? (
          <>
            <p>This goes live immediately and is labelled <b>Unreviewed</b>, because no second person will have checked it. The action is recorded in the audit log.</p>
            <div className="row"><button className="btn" disabled={busy} onClick={publishNow}>{busy ? "Publishing…" : "Publish now"}</button><button className="btn secondary" onClick={() => setDlg(null)}>Cancel</button></div>
          </>
        ) : (
          <>
            <p>This permanently deletes the question. Its text, options and explanations cannot be recovered. Students who already practised it will see it as no longer available.</p>
            <div className="row"><button className="btn danger" disabled={busy} onClick={deleteDraft}>{busy ? "Deleting…" : "Delete permanently"}</button><button className="btn secondary" onClick={() => setDlg(null)}>Keep it</button></div>
          </>
        )}
      </Dialog>

      <aside aria-label="Learner preview" style={{ display: preview || undefined ? "block" : undefined }} className={preview ? "" : "preview-hidden"}>
        {preview && (
          <div className="card" style={{ position: "sticky", top: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Preview (as learners see it, with the answer revealed)</h2>
            <QuestionMeta {...previewItem.question!} />
            <div style={{ margin: "0.8rem 0" }}><Markdown>{stem || "_(stem)_"}</Markdown></div>
            <OptionList item={previewItem} choice="" locked showReveal />
          </div>
        )}
      </aside>
    </div>
  );
}

export function ContributionStatus({ c }: { c: { id: string; state: string; revisionState: string; revisionNumber: number; requestedChanges: string | null; draft: Draft } }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [confirmW, setConfirmW] = useState(false);
  const [confirmD, setConfirmD] = useState(false);
  const canRevise = (c.state === "changes_requested" || c.state === "published") && !["pending", "draft"].includes(c.revisionState);
  const canWithdraw = !["withdrawn", "rejected"].includes(c.state);
  return (
    <div className="stack">
      <p>Status: <span className="badge">{c.state.replace("_", " ")}</span> <span className="badge">Revision {c.revisionNumber}: {c.revisionState.replace("_", " ")}</span></p>
      {c.revisionState === "pending" && <p className="notice">Waiting for a reviewer. You will see requested changes here.</p>}
      {c.requestedChanges && <div className="notice warn"><b>Reviewer feedback:</b> {c.requestedChanges}</div>}
      {c.state === "rejected" && <p className="notice bad">This submission was not accepted.</p>}
      {c.state === "withdrawn" && <p className="notice">This contribution has been withdrawn and is not visible to learners.</p>}
      <div className="card">
        <Markdown>{c.draft.stem}</Markdown>
        <ul>{c.draft.options.map((o) => <li key={o.id}>{o.id === c.draft.correctOptionId ? "✓ " : ""}{o.text}</li>)}</ul>
      </div>
      <div className="row">
        {canRevise && <button className="btn" onClick={async () => { try { await api("POST", `/api/contributions/${c.id}/revise`); router.refresh(); } catch (e) { setErr((e as Error).message); } }}>{c.state === "published" ? "Propose an edit" : "Edit and resubmit"}</button>}
        {canWithdraw && <button className="btn secondary" onClick={() => setConfirmW(true)}>Withdraw</button>}
        <button className="btn danger" onClick={() => setConfirmD(true)}>Delete</button>
      </div>
      {confirmD && (
        <div className="notice bad" role="alertdialog" aria-label="Confirm deletion">
          <p>Permanently delete this question? Its text, options and explanations cannot be recovered. Students who already practised it will see it as no longer available. To hide it but keep it, use Withdraw instead.</p>
          <button className="btn danger" onClick={async () => { try { await api("DELETE", `/api/contributions/${c.id}`); router.push("/contribute"); router.refresh(); } catch (e) { setErr((e as Error).message); setConfirmD(false); } }}>Yes, delete permanently</button>{" "}
          <button className="btn secondary" onClick={() => setConfirmD(false)}>Cancel</button>
        </div>
      )}
      {confirmW && (
        <div className="notice bad" role="alertdialog" aria-label="Confirm withdrawal">
          <p>Withdraw this contribution? It will be removed from learners’ sessions.</p>
          <button className="btn danger" onClick={async () => { try { await api("POST", `/api/contributions/${c.id}/withdraw`); router.refresh(); setConfirmW(false); } catch (e) { setErr((e as Error).message); } }}>Yes, withdraw</button>{" "}
          <button className="btn secondary" onClick={() => setConfirmW(false)}>Cancel</button>
        </div>
      )}
      {err && <p role="alert" className="field-error">{err}</p>}
    </div>
  );
}
