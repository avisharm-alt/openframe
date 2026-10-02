// End-to-end walkthrough against a RUNNING server (real HTTP, real auth, real SQLite):
//   contribution -> independent review -> publication -> practice -> report -> withdrawal
// plus security probes (uploads, CSRF origin, role escalation, cross-user access).
//
//   BASE_URL=http://localhost:3100 DATABASE_PATH=./data/e2e.db tsx scripts/e2e-walkthrough.ts
//
// The server must share DATABASE_PATH with this script (it grants the reviewer role directly in the
// database, exactly like `npm run admin:grant` does).
import { getDb } from "../src/lib/db";

const BASE = process.env.BASE_URL || "http://localhost:3100";
let failures = 0;
const results: string[] = [];
function check(name: string, ok: boolean, extra = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : extra ? `  -> ${extra}` : ""}`);
  if (!ok) failures++;
}

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { Origin: BASE, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) {
      const jar = new Map(this.cookie.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]));
      for (const c of set) jar.set(c.split("=")[0], c.split(";")[0]);
      this.cookie = [...jar.values()].join("; ");
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json: json as Record<string, any> };
  }
}

async function signUp(name: string) {
  // Demo mode only: password sign-up. Production uses Google (see scripts/prod-config-check.ts).
  const c = new Client();
  const email = `${name}-${Date.now()}@example.test`;
  const r = await c.req("POST", "/api/auth/sign-up/email", { name, email, password: "correct-horse-battery" });
  if (r.status !== 200) throw new Error(`sign-up failed: ${r.status} ${JSON.stringify(r.json)}`);
  return { c, email, id: r.json.user.id as string };
}
const grant = (id: string, role: string) => getDb().prepare('UPDATE "user" SET role = ? WHERE id = ?').run(role, id);

async function main() {
  const guest = new Client();
  const health = await guest.req("GET", "/api/health");
  check("health endpoint reports ok", health.status === 200 && health.json.status === "ok", JSON.stringify(health.json));
  const courses = (await guest.req("GET", "/api/courses")).json.courses as any[];
  check("guest can list courses without an account", courses.length >= 1, JSON.stringify(courses));
  const demo = courses.find((c) => c.code === "DEMO-101")!;
  const detail = (await guest.req("GET", `/api/courses/${demo.slug}`)).json as any;
  const topic = detail.units[0].topics[0];
  const search = (await guest.req("GET", "/api/courses?q=statistics")).json.courses as any[];
  check("search by title finds courses", search.some((c) => c.code === "DEMO-102"));
  const topicSearch = (await guest.req("GET", "/api/courses?q=recursion")).json.courses as any[];
  check("search by topic finds courses", topicSearch.some((c) => c.code === "DEMO-101"));

  // --- maintainer bootstrap via INITIAL_MAINTAINER_EMAILS (server started with bootstrap@example.test listed)
  const bc = new Client();
  const bEmail = "bootstrap@example.test";
  const bUp = await bc.req("POST", "/api/auth/sign-up/email", { name: "bootstrap", email: bEmail, password: "correct-horse-battery" });
  const bId = bUp.json.user?.id as string;
  check("a listed but UNVERIFIED email is not promoted", (await bc.req("GET", "/api/me")).json.user?.role === "student" && (await bc.req("GET", "/api/moderation/queue")).status === 403);
  getDb().prepare('UPDATE "user" SET emailVerified = 1 WHERE id = ?').run(bId); // stands in for Google having verified it
  const bc2 = new Client();
  await bc2.req("POST", "/api/auth/sign-in/email", { email: bEmail, password: "correct-horse-battery" });
  check("a listed, verified email becomes maintainer on its next sign-in", (await bc2.req("GET", "/api/me")).json.user?.role === "maintainer" && (await bc2.req("GET", "/api/moderation/events")).status === 200);

  // --- accounts
  const author = await signUp("author");
  const reviewer = await signUp("reviewer");
  const other = await signUp("other");
  grant(reviewer.id, "reviewer");

  // --- role escalation attempts
  await author.c.req("POST", "/api/auth/update-user", { name: "author", role: "maintainer" });
  const me = (await author.c.req("GET", "/api/me")).json as any;
  check("user cannot grant themselves a role via auth API", me.user?.role === "student", JSON.stringify(me));
  const su = await new Client().req("POST", "/api/auth/sign-up/email", { name: "sneaky", email: `sneaky-${Date.now()}@example.test`, password: "correct-horse-battery", role: "maintainer" });
  const sneakyRole = getDb().prepare('SELECT role FROM "user" WHERE id = ?').get(su.json.user?.id) as { role: string } | undefined;
  check("sign-up cannot set a role", sneakyRole?.role === "student", JSON.stringify(sneakyRole));
  const dn = await author.c.req("POST", "/api/auth/update-user", { name: "Quiet Otter" });
  const dnBad = await author.c.req("POST", "/api/auth/update-user", { name: "x" });
  const dnLong = await author.c.req("POST", "/api/auth/update-user", { name: "y".repeat(80) });
  check("users can change their display name; invalid names are rejected", dn.status === 200 && dnBad.status >= 400 && dnLong.status >= 400 && (await author.c.req("GET", "/api/me")).json.user?.name === "Quiet Otter", `${dn.status}/${dnBad.status}/${dnLong.status}`);
  check("student cannot open moderation API", (await author.c.req("GET", "/api/moderation/queue")).status === 403);
  check("anonymous cannot open moderation API", (await guest.req("GET", "/api/moderation/queue")).status === 401);

  // --- contribution
  const optIds = Array.from({ length: 4 }, () => crypto.randomUUID());
  const draft = {
    courseId: detail.id, topicId: topic.id,
    stem: "In Python, which keyword starts a conditional branch that runs only when its test is true?",
    learningObjective: "Recognise the keyword that begins a conditional statement.",
    options: [
      { id: optIds[0], text: "`if`", explanation: "`if` starts a conditional branch evaluated against a test." },
      { id: optIds[1], text: "`def`", explanation: "`def` defines a function, it does not branch." },
      { id: optIds[2], text: "`import`", explanation: "`import` loads a module." },
      { id: optIds[3], text: "`class`", explanation: "`class` defines a new type." },
    ],
    correctOptionId: optIds[0], difficulty: "introductory", aiProvenance: "ai_assisted",
    checkDescription: "Checked against the Python language reference.",
  };
  const created = await author.c.req("POST", "/api/contributions", draft);
  check("contributor can save a draft", created.status === 200, JSON.stringify(created.json));
  const qid = created.json.id as string;
  const bad = await author.c.req("POST", `/api/contributions/${qid}/submit`, { attested: false });
  check("submission requires the attestation", bad.status === 422);
  const sub = await author.c.req("POST", `/api/contributions/${qid}/submit`, { attested: true });
  check("contributor can submit for review (never published immediately)", sub.status === 200 && sub.json.state === "pending_review", JSON.stringify(sub.json));
  check("pending question is not publicly accessible", (await guest.req("GET", `/api/questions/${qid}`)).status === 404);
  check("other user cannot read the contributor's draft", (await other.c.req("GET", `/api/contributions/${qid}`)).status === 404);

  const queue = (await reviewer.c.req("GET", "/api/moderation/queue")).json.queue as any[];
  const item = queue.find((q) => q.questionId === qid);
  check("reviewer sees the submission in the queue", !!item);
  const allChecks = Object.fromEntries(["attestation", "mapping", "one_answer", "explanations", "distractors", "not_assessment", "references"].map((k) => [k, true]));
  grant(author.id, "reviewer"); // even a reviewer role must not allow self-approval
  const self = await author.c.req("POST", `/api/moderation/revisions/${item.revisionId}/review`, { decision: "approve", checklist: allChecks });
  check("author cannot approve their own submission (even with reviewer role)", self.status === 403, JSON.stringify(self.json));
  grant(author.id, "student");
  const approve = await reviewer.c.req("POST", `/api/moderation/revisions/${item.revisionId}/review`, { decision: "approve", checklist: allChecks, privateNote: "ok" });
  check("independent reviewer publishes the question", approve.status === 200, JSON.stringify(approve.json));
  const pub = await guest.req("GET", `/api/questions/${qid}`);
  check("published question is publicly visible and reviewed, without key/explanations", pub.status === 200 && pub.json.reviewStatus === "student_reviewed" && !JSON.stringify(pub.json).match(/explanation|correctOption/), JSON.stringify(pub.json));

  // --- guest practice (default = student-reviewed only => exactly our question)
  const created1 = await guest.req("POST", "/api/sessions", { courseId: detail.id, topicIds: [topic.id], count: 10, mode: "practice", includeUnreviewed: false });
  check("guest starts practice with reviewed questions only; count not padded", created1.status === 200 && created1.json.total === 1, JSON.stringify(created1.json));
  const sid = created1.json.id as string;
  const st = (await guest.req("GET", `/api/sessions/${sid}`)).json as any;
  const first = st.items[0];
  check("session JSON before answering has no key", !JSON.stringify(st).includes("correctOptionId") && first.reveal === null);
  const wrongId = first.question.options.find((o: any) => o.id !== optIds[0]).id;
  const ans = await guest.req("POST", `/api/sessions/${sid}/answer`, { sessionQuestionId: first.id, optionId: wrongId });
  check("practice mode reveals correctness and per-option explanations", ans.json.correct === false && ans.json.correctOptionId === optIds[0] && Object.keys(ans.json.explanations).length === 4, JSON.stringify(ans.json));
  const fin = await guest.req("POST", `/api/sessions/${sid}/finish`);
  check("results are accurate", fin.json.total === 1 && fin.json.incorrect === 1 && fin.json.correct === 0 && fin.json.missed.length === 1, JSON.stringify(fin.json));
  const retry = await guest.req("POST", "/api/sessions", { retryFrom: sid, count: 10, mode: "practice", includeUnreviewed: true });
  check("retry-missed starts a session with the missed question", retry.status === 200 && retry.json.total === 1);

  // --- self-test leak check
  const stSession = await guest.req("POST", "/api/sessions", { courseId: detail.id, count: 3, mode: "self_test", includeUnreviewed: true });
  const stState = (await guest.req("GET", `/api/sessions/${stSession.json.id}`)).json as any;
  const stAns = await guest.req("POST", `/api/sessions/${stSession.json.id}/answer`, { sessionQuestionId: stState.items[0].id, optionId: stState.items[0].question.options[0].id });
  const mid = JSON.stringify((await guest.req("GET", `/api/sessions/${stSession.json.id}`)).json);
  check("self-test leaks neither key nor explanations before completion", JSON.stringify(stAns.json) === '{"saved":true}' && !/explanation|correctOptionId|isCorrect/.test(mid) && !mid.includes('"reveal":{'), mid.slice(0, 200));

  // --- cross-user session access
  const priv = await author.c.req("POST", "/api/sessions", { courseId: detail.id, count: 2, mode: "practice", includeUnreviewed: true });
  check("another user cannot read someone's session", (await other.c.req("GET", `/api/sessions/${priv.json.id}`)).status === 404 && (await guest.req("GET", `/api/sessions/${priv.json.id}`)).status === 404);

  // --- report -> withdrawal
  const live = await guest.req("POST", "/api/sessions", { courseId: detail.id, topicIds: [topic.id], count: 10, mode: "practice", includeUnreviewed: false });
  const rep = await guest.req("POST", "/api/reports", { questionId: qid, category: "prohibited", details: "Looks like it could be from a real test." });
  check("anyone can report a question", rep.status === 200, JSON.stringify(rep.json));
  check("a single report does not remove content", (await guest.req("GET", `/api/questions/${qid}`)).status === 200);
  const reports = (await reviewer.c.req("GET", "/api/moderation/reports")).json.reports as any[];
  check("prohibited-content report is prioritised in the moderation queue", reports[0]?.id === rep.json.id && reports[0].priority === 1);
  const wd = await reviewer.c.req("POST", `/api/moderation/questions/${qid}/withdraw`, { reason: "Possible assessment content", reportId: rep.json.id });
  check("moderator can withdraw", wd.status === 200, JSON.stringify(wd.json));
  check("withdrawn question disappears from public API", (await guest.req("GET", `/api/questions/${qid}`)).status === 404);
  const afterState = (await guest.req("GET", `/api/sessions/${live.json.id}`)).json as any;
  check("active session shows unavailable notice instead of content", afterState.items[0].status === "unavailable" && afterState.items[0].question === null);
  const afterAns = await guest.req("POST", `/api/sessions/${live.json.id}/answer`, { sessionQuestionId: afterState.items[0].id, optionId: wrongId });
  check("answers to withdrawn questions are refused", afterAns.status === 409);
  const afterFin = (await guest.req("POST", `/api/sessions/${live.json.id}/finish`)).json as any;
  check("withdrawn questions are excluded from scoring", afterFin.total === 0 && afterFin.unavailable === 1, JSON.stringify(afterFin));
  const newSess = await guest.req("POST", "/api/sessions", { courseId: detail.id, topicIds: [topic.id], count: 10, mode: "practice", includeUnreviewed: false });
  check("new sessions exclude withdrawn content", newSess.status === 422 && newSess.json.error?.code === "no_questions", JSON.stringify(newSess.json));
  check("report resolved by withdrawal", ((await reviewer.c.req("GET", "/api/moderation/reports?state=resolved")).json.reports as any[]).some((r) => r.id === rep.json.id));

  // --- upload / CSRF probes
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }), "exam.pdf");
  const up = await fetch(BASE + "/api/contributions", { method: "POST", headers: { Origin: BASE, Cookie: author.c.cookie }, body: form });
  check("multipart file upload to the API is rejected (415)", up.status === 415, String(up.status));
  const pdf = await fetch(BASE + "/api/contributions", { method: "POST", headers: { Origin: BASE, Cookie: author.c.cookie, "Content-Type": "application/pdf" }, body: "%PDF-1.4" });
  check("raw PDF body is rejected (415)", pdf.status === 415, String(pdf.status));
  const smuggle = await author.c.req("POST", "/api/contributions", { ...draft, attachment: "data:application/pdf;base64,AAAA" });
  check("unknown/file fields in JSON are rejected", smuggle.status === 422, String(smuggle.status));
  const xo = await fetch(BASE + "/api/reports", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ category: "other", details: "x" }) });
  check("cross-origin state-changing request is rejected", xo.status === 403, String(xo.status));
  const js = await author.c.req("POST", "/api/contributions", { ...draft, referenceUrl: "javascript:alert(1)" });
  check("non-http(s) reference links are rejected", js.status === 422, String(js.status));

  // --- deletion and maintainer publishing
  const fresh = (stem: string) => {
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    return { ...draft, stem, options: (draft.options as any[]).map((o, i) => ({ ...o, id: ids[i] })), correctOptionId: ids[0] };
  };
  const maint = await signUp("maintainer");
  grant(maint.id, "maintainer");
  const mine1 = (await author.c.req("POST", "/api/contributions", fresh("Which keyword begins a conditional branch in Python code?"))).json.id as string;
  const delOwn = await author.c.req("DELETE", `/api/contributions/${mine1}`);
  check("author can permanently delete their own draft", delOwn.status === 200 && delOwn.json.outcome === "removed", JSON.stringify(delOwn.json));
  check("deleted draft is gone", (await author.c.req("GET", `/api/contributions/${mine1}`)).status === 404);
  const theirs = (await author.c.req("POST", "/api/contributions", fresh("Which statement repeats a block while a test remains true here?"))).json.id as string;
  check("another user cannot delete someone else's question (404)", (await other.c.req("DELETE", `/api/contributions/${theirs}`)).status === 404);
  check("...and it still exists", (await author.c.req("GET", `/api/contributions/${theirs}`)).status === 200);
  check("a signed-out request cannot delete (401)", (await guest.req("DELETE", `/api/contributions/${theirs}`)).status === 401);
  const crossDel = await fetch(BASE + `/api/contributions/${theirs}`, { method: "DELETE", headers: { Origin: "https://evil.example", Cookie: author.c.cookie } });
  check("cross-origin delete is rejected", crossDel.status === 403, String(crossDel.status));
  check("reviewers cannot use maintainer delete (403)", (await reviewer.c.req("DELETE", `/api/moderation/questions/${theirs}`, { reason: "not allowed here" })).status === 403);
  check("students cannot use maintainer delete (403)", (await other.c.req("DELETE", `/api/moderation/questions/${theirs}`, { reason: "not allowed here" })).status === 403);
  check("students cannot publish without review (403)", (await author.c.req("POST", `/api/contributions/${theirs}/publish`, { attested: true })).status === 403);
  check("students cannot list all questions (403)", (await other.c.req("GET", "/api/moderation/questions")).status === 403);

  const mq = (await maint.c.req("POST", "/api/contributions", fresh("Which Python construct selects between two paths using a test?"))).json.id as string;
  check("publishing requires the attestation", (await maint.c.req("POST", `/api/contributions/${mq}/publish`, { attested: false })).status === 422);
  check("maintainer cannot publish another person's draft (404)", (await maint.c.req("POST", `/api/contributions/${theirs}/publish`, { attested: true })).status === 404);
  const pubNow = await maint.c.req("POST", `/api/contributions/${mq}/publish`, { attested: true });
  check("maintainer can publish their own question without a second reviewer", pubNow.status === 200 && pubNow.json.state === "published", JSON.stringify(pubNow.json));
  const mpub = await guest.req("GET", `/api/questions/${mq}`);
  check("it is public but labelled unreviewed", mpub.status === 200 && mpub.json.reviewStatus === "unreviewed", JSON.stringify(mpub.json));

  const all = (await maint.c.req("GET", "/api/moderation/questions")).json.questions as any[];
  const asDraft = all.find((q) => q.id === theirs);
  check("maintainer can see every question, but not other people's draft text", !!all.find((q) => q.id === mq) && asDraft?.stem === null);
  check("maintainer delete needs a reason", (await maint.c.req("DELETE", `/api/moderation/questions/${theirs}`, { reason: "no" })).status === 422);
  const delOther = await maint.c.req("DELETE", `/api/moderation/questions/${theirs}`, { reason: "Spam draft for the e2e check" });
  check("maintainer can delete anyone's question", delOther.status === 200 && delOther.json.outcome === "removed", JSON.stringify(delOther.json));
  check("...and the author no longer has it", (await author.c.req("GET", `/api/contributions/${theirs}`)).status === 404);
  check("deleting twice is a 404", (await maint.c.req("DELETE", `/api/moderation/questions/${theirs}`, { reason: "Spam draft for the e2e check" })).status === 404);

  const practised = await guest.req("POST", "/api/sessions", { courseId: detail.id, topicIds: [topic.id], count: 20, mode: "practice", includeUnreviewed: true });
  const pItem = (practised.json.items as any[] | undefined)?.find((i) => i.question?.questionId === mq)
    ?? ((await guest.req("GET", `/api/sessions/${practised.json.id}`)).json.items as any[]).find((i) => i.question?.questionId === mq);
  check("a practised question appears in a session", !!pItem, JSON.stringify(practised.json).slice(0, 200));
  const delPractised = await maint.c.req("DELETE", `/api/moderation/questions/${mq}`, { reason: "Removed after practice for e2e" });
  check("deleting a practised question erases it but keeps others' history intact", delPractised.status === 200 && delPractised.json.outcome === "erased", JSON.stringify(delPractised.json));
  const afterDel = ((await guest.req("GET", `/api/sessions/${practised.json.id}`)).json.items as any[]).find((i) => i.id === pItem?.id);
  check("the practising student sees it as unavailable, with no content", afterDel?.status === "unavailable" && afterDel.question === null, JSON.stringify(afterDel));
  check("deleted question is gone from the public API", (await guest.req("GET", `/api/questions/${mq}`)).status === 404);
  check("maintainer cannot withdraw or restore a deleted question", (await maint.c.req("POST", `/api/moderation/questions/${mq}/withdraw`, { reason: "should not apply" })).status === 404 && (await maint.c.req("POST", `/api/moderation/questions/${mq}/restore`)).status === 409);

  // --- private notes
  const noteBody = {
    courseId: detail.id, title: "Week 3: recursion", ownWork: true, aiConsent: true,
    text: "Distinctive notes sentence about accumulators. " + "Recursion replaces a loop with a function that calls itself on a smaller input. ".repeat(4),
  };
  check("signed-out users cannot send notes (401)", (await guest.req("POST", "/api/notes", noteBody)).status === 401);
  check("notes need the own-work confirmation", (await author.c.req("POST", "/api/notes", { ...noteBody, ownWork: false })).status === 422);
  check("notes need the AI-use consent", (await author.c.req("POST", "/api/notes", { ...noteBody, aiConsent: false })).status === 422);
  const withEmail = await author.c.req("POST", "/api/notes", { ...noteBody, text: noteBody.text + " Contact me at someone@example.com" });
  check("notes containing an email address are refused", withEmail.status === 422 && withEmail.json.error?.code === "personal_info", JSON.stringify(withEmail.json));
  const mkForm = (fields: Record<string, string>, files: { name: string; bytes: Uint8Array }[] = [], extra: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ courseId: detail.id, title: "Uploaded notes", ownWork: "true", aiConsent: "true", text: "", ...fields, ...extra })) fd.append(k, v);
    for (const f of files) fd.append("files", new Blob([f.bytes as BlobPart]), f.name);
    return fd;
  };
  const postForm = (who: Client, fd: FormData, origin = BASE) => fetch(BASE + "/api/notes", { method: "POST", headers: { Origin: origin, Cookie: who.cookie }, body: fd });
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 distinctive uploaded file content ".repeat(20));
  const stray = await postForm(author.c, mkForm({}, [{ name: "n.pdf", bytes: pdfBytes }], { surprise: "x" }));
  check("unexpected fields in an upload are refused", stray.status === 422, String(stray.status));
  const reportsUpload = await fetch(BASE + "/api/reports", { method: "POST", headers: { Origin: BASE, Cookie: author.c.cookie }, body: mkForm({}, [{ name: "n.pdf", bytes: pdfBytes }]) });
  check("file uploads are still rejected on every other endpoint (415)", reportsUpload.status === 415, String(reportsUpload.status));
  const exe = await postForm(author.c, mkForm({}, [{ name: "setup.exe", bytes: new TextEncoder().encode("MZ not really") }]));
  check("programs are refused", exe.status === 422 && /not accepted/i.test(JSON.stringify(await exe.json())), String(exe.status));
  const disguised = new Uint8Array(0x100); disguised.set([0x4d, 0x5a]); disguised[0x3c] = 0x80; disguised.set([0x50, 0x45, 0, 0], 0x80);
  const renamed = await postForm(author.c, mkForm({}, [{ name: "lecture.pdf", bytes: disguised }]));
  check("a program renamed to .pdf is refused", renamed.status === 422, String(renamed.status));
  const tooBig = await postForm(author.c, mkForm({}, [{ name: "huge.pdf", bytes: new Uint8Array(16 * 1024 * 1024).fill(65) }]));
  check("a file over 15 MB is refused with a clear message", tooBig.status === 422 && /15 MB/.test(JSON.stringify(await tooBig.json())), String(tooBig.status));
  const wayTooBig = await postForm(author.c, mkForm({}, [{ name: "enormous.bin.pdf", bytes: new Uint8Array(48 * 1024 * 1024).fill(65) }]));
  check("an upload over the request cap is refused before it is read (413)", wayTooBig.status === 413, String(wayTooBig.status));
  const noteXo = await fetch(BASE + "/api/notes", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", Cookie: author.c.cookie }, body: JSON.stringify(noteBody) });
  check("cross-origin note submission is rejected", noteXo.status === 403, String(noteXo.status));
  const sentNote = await author.c.req("POST", "/api/notes", noteBody);
  check("a student can send notes privately", sentNote.status === 200 && !!sentNote.json.id && !!sentNote.json.expiresAt, JSON.stringify(sentNote.json));
  const noteId = sentNote.json.id as string;
  const myNotes = (await author.c.req("GET", "/api/notes")).json.notes as any[];
  check("the author sees their note's status but never its text", myNotes.some((n) => n.id === noteId && n.status === "new") && !JSON.stringify(myNotes).includes("Distinctive notes sentence"));
  check("another student cannot see or delete it", !(((await other.c.req("GET", "/api/notes")).json.notes as any[]).some((n) => n.id === noteId)) && (await other.c.req("DELETE", `/api/notes/${noteId}`)).status === 404);
  check("reviewers cannot read shared notes (403)", (await reviewer.c.req("GET", "/api/moderation/notes")).status === 403 && (await reviewer.c.req("GET", `/api/moderation/notes/${noteId}`)).status === 403);
  check("students cannot read shared notes (403)", (await other.c.req("GET", "/api/moderation/notes")).status === 403);
  const notesList = (await maint.c.req("GET", "/api/moderation/notes")).json.notes as any[];
  check("a maintainer sees the note with the sender's display name", notesList.some((n) => n.id === noteId && typeof n.authorName === "string" && n.authorName.length > 0), JSON.stringify(notesList));
  const noteFull = await maint.c.req("GET", `/api/moderation/notes/${noteId}`);
  check("a maintainer can open the full text", noteFull.status === 200 && String(noteFull.json.text).includes("Distinctive notes sentence"));
  check("a maintainer can mark it used", (await maint.c.req("PATCH", `/api/moderation/notes/${noteId}`, { status: "used" })).status === 200 && ((await author.c.req("GET", "/api/notes")).json.notes as any[]).find((n) => n.id === noteId)?.status === "used");
  const noteEvents = (await maint.c.req("GET", "/api/moderation/events")).json.events as any[];
  check("opening a note is audit-logged without its text", noteEvents.some((e) => e.action === "note_opened") && !JSON.stringify(noteEvents).includes("Distinctive notes sentence"));
  const bigBytes = new Uint8Array(12 * 1024 * 1024).map((_, i) => i % 251);
  const withFiles = await postForm(author.c, mkForm({ title: "Notes with files" }, [{ name: "Week 3 notes.pdf", bytes: pdfBytes }, { name: "scan.png", bytes: bigBytes }]));
  const wf = (await withFiles.json()) as any;
  check("a student can upload files, including a 12 MB one, through the real server", withFiles.status === 200 && !!wf.id, JSON.stringify(wf));
  const mineWithFiles = ((await author.c.req("GET", "/api/notes")).json.notes as any[]).find((n) => n.id === wf.id);
  check("the author sees file names and sizes only", mineWithFiles?.files?.length === 2 && Object.keys(mineWithFiles.files[0]).sort().join() === "name,size", JSON.stringify(mineWithFiles));
  const filesFull = (await maint.c.req("GET", `/api/moderation/notes/${wf.id}`)).json as any;
  check("a maintainer sees the files", filesFull.files?.length === 2 && filesFull.files[0].name === "Week 3 notes.pdf", JSON.stringify(filesFull.files));
  const dl = await fetch(BASE + `/api/moderation/notes/${wf.id}/files/${filesFull.files[1].id}`, { headers: { Cookie: maint.c.cookie } });
  const dlBytes = new Uint8Array(await dl.arrayBuffer());
  check("a maintainer can download a file, byte for byte", dl.status === 200 && dlBytes.length === bigBytes.length && dlBytes.every((b, i) => b === bigBytes[i]));
  check("downloads are forced attachments that can never run in the site's origin",
    /^attachment;/.test(dl.headers.get("content-disposition") ?? "") && dl.headers.get("content-type") === "application/octet-stream" && dl.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(dl.headers.get("content-security-policy") ?? ""),
    JSON.stringify([...dl.headers.entries()].filter(([k]) => /content-|x-content/.test(k))));
  check("reviewers and students cannot download files (403)",
    (await fetch(BASE + `/api/moderation/notes/${wf.id}/files/${filesFull.files[0].id}`, { headers: { Cookie: reviewer.c.cookie } })).status === 403 &&
    (await fetch(BASE + `/api/moderation/notes/${wf.id}/files/${filesFull.files[0].id}`, { headers: { Cookie: other.c.cookie } })).status === 403);
  check("signed-out requests cannot download files (401)", (await fetch(BASE + `/api/moderation/notes/${wf.id}/files/${filesFull.files[0].id}`)).status === 401);
  const evAfter = (await maint.c.req("GET", "/api/moderation/events")).json.events as any[];
  check("downloads are audit-logged", evAfter.some((e) => e.action === "note_file_downloaded"));
  check("deleting a note with files works", (await author.c.req("DELETE", `/api/notes/${wf.id}`)).status === 200 && (await maint.c.req("GET", `/api/moderation/notes/${wf.id}`)).status === 404);
  check("the author can delete their note", (await author.c.req("DELETE", `/api/notes/${noteId}`)).status === 200 && (await maint.c.req("GET", `/api/moderation/notes/${noteId}`)).status === 404);

  // --- account deletion keeps published content anonymous
  const del = await other.c.req("DELETE", "/api/account", { confirm: "DELETE" });
  check("user can delete their account", del.status === 200);
  check("deleted user's session no longer works", (await other.c.req("GET", "/api/me")).json.user === null);

  console.log("\n" + results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
