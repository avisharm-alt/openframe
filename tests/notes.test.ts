import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeUser, seeded } from "./helpers";
import {
  MAX_NOTES_PER_USER, deleteMyNote, deleteNoteAsMaintainer, getNoteForReview, listMyNotes, listNotesForReview, purgeExpiredNotes, readNoteFile, setNoteStatus,
  submitNote, sweepOrphanNoteFiles, type IncomingFile,
} from "@/lib/services/notes";
import { listEvents } from "@/lib/services/moderation";
import { deleteAccount } from "@/lib/services/account";
import { NOTES_AI_CONSENT_TEXT, NOTES_CONSENT_VERSION, NOTES_OWN_WORK_TEXT, NOTES_RETENTION_DAYS } from "@/lib/attestation";
import { personalInfoProblems } from "@/lib/validation";
import type { DB } from "@/lib/db";

let db: DB;
let ctx: ReturnType<typeof seeded>;
let dir: string;
beforeEach(() => {
  db = freshDb();
  ctx = seeded(db);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "openframe-notes-"));
  process.env.NOTES_DIR = dir;
  delete process.env.NOTES_MAX_TOTAL_MB;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.NOTES_DIR;
  delete process.env.NOTES_MAX_TOTAL_MB;
});
const onDisk = () => fs.readdirSync(dir).filter((n) => !n.startsWith("."));

const SECRET = "Distinctive sentence about tail recursion and accumulators that must never leak.";
const body = (extra = "") => `${SECRET} ${"Recursion replaces a loop with a function that calls itself on a smaller input. ".repeat(4)}${extra}`;
const note = (overrides: Record<string, unknown> = {}) => ({
  courseId: ctx.demo101.courseId, title: "Week 3: recursion", text: body(), ownWork: true, aiConsent: true, ...overrides,
});
const count = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

describe("submitting notes", () => {
  it("stores a note privately with the exact consent text and a deletion date", () => {
    const s = makeUser(db, "Student");
    const r = submitNote(s, note());
    expect(Date.parse(r.expiresAt) - Date.now()).toBeGreaterThan((NOTES_RETENTION_DAYS - 1) * 86_400_000);
    const row = db.prepare("SELECT status, consent_version AS v, consent_text AS t, consented_at AS at FROM resource_note WHERE id = ?").get(r.id) as Record<string, string>;
    expect(row.status).toBe("new");
    expect(row.v).toBe(NOTES_CONSENT_VERSION);
    expect(row.t).toContain(NOTES_OWN_WORK_TEXT);
    expect(row.t).toContain(NOTES_AI_CONSENT_TEXT);
    expect(row.at).toBeTruthy();
  });

  it("requires both confirmations, a real course and a sensible length", () => {
    const s = makeUser(db, "Student");
    expect(() => submitNote(s, note({ ownWork: false }))).toThrow();
    expect(() => submitNote(s, note({ aiConsent: false }))).toThrow();
    expect(() => submitNote(s, { ...note(), ownWork: undefined })).toThrow();
    expect(() => submitNote(s, note({ text: "too short" }))).toThrow();
    expect(() => submitNote(s, note({ text: "x ".repeat(25_000) }))).toThrow();
    expect(() => submitNote(s, note({ courseId: crypto.randomUUID() }))).toThrow(/not available/i);
    expect(() => submitNote(s, note({ attachment: "data:application/pdf;base64,AAAA" }))).toThrow(); // no unknown fields
    expect(count("SELECT COUNT(*) AS n FROM resource_note")).toBe(0);
  });

  it("refuses notes that contain an email address, phone number or student number", () => {
    const s = makeUser(db, "Student");
    expect(() => submitNote(s, note({ text: body("Ask me at jane.doe@example.com") }))).toThrow(/email address/);
    expect(() => submitNote(s, note({ text: body("Call 519-555-0142 before the quiz") }))).toThrow(/phone number/);
    expect(() => submitNote(s, note({ text: body("Student number: 250123456") }))).toThrow(/student number/);
    expect(() => submitNote(s, note({ title: "Notes from jane@example.com" }))).toThrow(/email address/);
    expect(count("SELECT COUNT(*) AS n FROM resource_note")).toBe(0);
  });

  it("does not mistake ordinary maths for personal details", () => {
    expect(personalInfoProblems("The value 123456789 appears; also 3.14159265 and 2^64 = 18446744073709551616. See page 100-200.")).toEqual([]);
    expect(personalInfoProblems("Use x@y when a@b is the stack top")).toEqual([]);
    expect(personalInfoProblems("mail a.b@school.ca or (519) 555 0100")).toEqual(["email", "phone"]);
  });

  it("flags exam-like wording and instructor mentions for maintainers without blocking", () => {
    const s = makeUser(db, "Student");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const r = submitNote(s, note({ text: body("From the midterm exam. Professor Smith said this is examinable.") }));
    const flags = getNoteForReview(maint, r.id).flags;
    expect(flags).toEqual(expect.arrayContaining(["assessment_keywords", "instructor_mention"]));
  });

  it("caps how many notes one person can keep", () => {
    const s = makeUser(db, "Student");
    for (let i = 0; i < MAX_NOTES_PER_USER; i++) submitNote(s, note({ title: `Notes part ${i + 1}` }));
    expect(() => submitNote(s, note())).toThrow(/already have/i);
    deleteMyNote(s, listMyNotes(s)[0].id);
    expect(() => submitNote(s, note())).not.toThrow();
  });
});

describe("who can see notes", () => {
  it("shows authors their own list without any note text, and nobody else's", () => {
    const a = makeUser(db, "Alice");
    const b = makeUser(db, "Bob");
    submitNote(a, note({ title: "Alice's notes" }));
    expect(listMyNotes(b)).toEqual([]);
    const mine = listMyNotes(a);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("new");
    expect(JSON.stringify(mine)).not.toContain("Distinctive sentence");
    expect(Object.keys(mine[0])).not.toContain("text");
    expect(Object.keys(mine[0])).not.toContain("body");
  });

  it("lets only maintainers read full text; students and reviewers are refused", () => {
    const s = makeUser(db, "Student");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { id } = submitNote(s, note());
    for (const who of [s, rev]) {
      expect(() => listNotesForReview(who)).toThrow(/maintainer/i);
      expect(() => getNoteForReview(who, id)).toThrow(/maintainer/i);
      expect(() => setNoteStatus(who, id, "used")).toThrow(/maintainer/i);
      expect(() => deleteNoteAsMaintainer(who, id)).toThrow(/maintainer/i);
    }
    const full = getNoteForReview(maint, id);
    expect(full.text).toContain("Distinctive sentence");
    expect(full.authorName).toBe("Student");
    expect(JSON.stringify(full)).not.toContain("@"); // no email address exposed with the note
    expect(listNotesForReview(maint).map((n) => n.id)).toEqual([id]);
  });

  it("never lets someone delete another person's note, and does not reveal that it exists", () => {
    const a = makeUser(db, "Alice");
    const b = makeUser(db, "Bob");
    const { id } = submitNote(a, note());
    expect(() => deleteMyNote(b, id)).toThrow(/not found/i);
    expect(() => deleteMyNote(b, crypto.randomUUID())).toThrow(/not found/i);
    expect(listMyNotes(a)).toHaveLength(1);
  });

  it("keeps notes out of questions, practice and the public catalogue", () => {
    const s = makeUser(db, "Student");
    submitNote(s, note());
    expect(count("SELECT COUNT(*) AS n FROM question_revision WHERE stem LIKE '%Distinctive sentence%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM question_option WHERE text LIKE '%Distinctive sentence%' OR explanation LIKE '%Distinctive sentence%'")).toBe(0);
  });
});

describe("lifecycle, deletion and the audit trail", () => {
  it("lets maintainers mark notes used or declined and delete them", () => {
    const s = makeUser(db, "Student");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { id } = submitNote(s, note());
    expect(setNoteStatus(maint, id, "used").status).toBe("used");
    expect(listMyNotes(s)[0].status).toBe("used");
    expect(() => setNoteStatus(maint, id, "published")).toThrow();
    deleteNoteAsMaintainer(maint, id);
    expect(listMyNotes(s)).toEqual([]);
    expect(() => getNoteForReview(maint, id)).toThrow(/not found/i);
  });

  it("deletes for good when the author deletes, including after a maintainer opened it", () => {
    const s = makeUser(db, "Student");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { id } = submitNote(s, note());
    getNoteForReview(maint, id);
    deleteMyNote(s, id);
    expect(count("SELECT COUNT(*) AS n FROM resource_note")).toBe(0);
  });

  it("deletes notes when the account is deleted", () => {
    const s = makeUser(db, "Student");
    submitNote(s, note());
    submitNote(s, note({ title: "Another set" }));
    deleteAccount(s.id);
    expect(count("SELECT COUNT(*) AS n FROM resource_note")).toBe(0);
  });

  it("deletes notes automatically after the retention period, before any read", () => {
    const s = makeUser(db, "Student");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const old = submitNote(s, note({ title: "Old notes" }));
    const fresh = submitNote(s, note({ title: "Fresh notes" }));
    const stale = new Date(Date.now() - (NOTES_RETENTION_DAYS + 1) * 86_400_000).toISOString();
    db.prepare("UPDATE resource_note SET created_at = ? WHERE id = ?").run(stale, old.id);
    expect(() => getNoteForReview(maint, old.id)).toThrow(/not found/i); // purged by the read itself
    expect(listMyNotes(s).map((n) => n.id)).toEqual([fresh.id]);

    const old2 = submitNote(s, note({ title: "Old again" }));
    db.prepare("UPDATE resource_note SET created_at = ? WHERE id = ?").run(stale, old2.id);
    expect(purgeExpiredNotes(db)).toBe(1);
    expect(listNotesForReview(maint).map((n) => n.id)).toEqual([fresh.id]);
  });

  it("records who opened or changed a note in the audit log, without the note text", () => {
    const s = makeUser(db, "Student");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { id } = submitNote(s, note());
    getNoteForReview(maint, id);
    setNoteStatus(maint, id, "used");
    deleteMyNote(s, id);
    const events = listEvents(maint) as { action: string; detail: string; actor_id?: string; actorName: string | null }[];
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["note_submitted", "note_opened", "note_status", "note_deleted_by_author"]));
    const dump = JSON.stringify(events);
    expect(dump).not.toContain("Distinctive sentence");
    expect(dump).not.toContain("tail recursion");
    expect(events.find((e) => e.action === "note_opened")!.actorName).toBe("Maintainer");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
const bytes = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s) : Uint8Array.from(s));
const f = (name: string, content: string | number[] | Uint8Array = "%PDF-1.4 lecture notes about recursion"): IncomingFile => ({ name, bytes: typeof content === "string" || Array.isArray(content) ? bytes(content) : content });
const noText = (extra: Record<string, unknown> = {}) => note({ text: "", ...extra });
const MB = 1024 * 1024;

describe("uploaded files", () => {
  it("stores files outside the database, with metadata, and gives them back unchanged to a maintainer only", () => {
    const s = makeUser(db, "Student");
    const maint = makeUser(db, "Maintainer", "maintainer");
    const rev = makeUser(db, "Reviewer", "reviewer");
    const content = bytes([37, 80, 68, 70, 45, 1, 2, 3, 250, 251, 252, 0, 7]);
    const { id } = submitNote(s, noText(), [f("Week 3 notes.pdf", content), f("diagram.png", [137, 80, 78, 71, 13, 10, 26, 10, 0, 1])]);
    expect(onDisk()).toHaveLength(2);
    expect(count("SELECT COUNT(*) AS n FROM note_file WHERE note_id = ?", id)).toBe(2);
    expect(JSON.stringify(db.prepare("SELECT * FROM note_file").all())).not.toContain("Week 3 notes.pdf".toUpperCase()); // metadata only; no bytes in the database

    const mine = listMyNotes(s)[0];
    expect(mine.files.map((x) => x.name)).toEqual(["Week 3 notes.pdf", "diagram.png"]);
    expect(Object.keys(mine.files[0]).sort()).toEqual(["name", "size"]); // authors never get file ids or bytes back

    const full = getNoteForReview(maint, id);
    expect(full.files).toHaveLength(2);
    const got = readNoteFile(maint, id, full.files[0].id);
    expect(got.name).toBe("Week 3 notes.pdf");
    expect(Buffer.from(got.bytes).equals(Buffer.from(content))).toBe(true);
    for (const who of [s, rev]) expect(() => readNoteFile(who, id, full.files[0].id)).toThrow(/maintainer/i);
    expect(() => readNoteFile(maint, crypto.randomUUID(), full.files[0].id)).toThrow(/not found/i);
    expect(() => readNoteFile(maint, id, crypto.randomUUID())).toThrow(/not found/i);
    const events = listEvents(maint) as { action: string; detail: string }[];
    expect(events.filter((e) => e.action === "note_file_downloaded")).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("Week 3 notes");
  });

  it("accepts any ordinary kind of file", () => {
    const s = makeUser(db, "Student");
    const kinds: IncomingFile[] = [
      f("notes.pdf"), f("slides.pptx", [0x50, 0x4b, 3, 4, 20, 0]), f("essay.docx", [0x50, 0x4b, 3, 4, 20, 0]), f("photo.jpg", [0xff, 0xd8, 0xff, 0xe0, 0, 16]),
      f("lecture.mp3", [0x49, 0x44, 0x33, 3, 0]), f("data.csv", "a,b\n1,2"), f("solution.py", "print('hi')"), f("README", "no extension"),
    ];
    for (const k of kinds) expect(() => submitNote(s, noText({ title: `Upload ${k.name}` }), [k]), k.name).not.toThrow();
    expect(onDisk()).toHaveLength(kinds.length);
  });

  it("refuses programs and browser-runnable files, including ones renamed to look harmless", () => {
    const s = makeUser(db, "Student");
    const pe = new Uint8Array(0x100); pe[0] = 0x4d; pe[1] = 0x5a; pe[0x3c] = 0x80; pe.set([0x50, 0x45, 0, 0], 0x80);
    const bad: [string, IncomingFile][] = [
      ["exe", f("setup.exe", "MZ stuff")],
      ["renamed PE", f("notes.pdf", pe)],
      ["ELF", f("lecture.pdf", [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])],
      ["Mach-O", f("slides.ppt", [0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1])],
      ["html", f("page.html", "<html><body>x</body></html>")],
      ["renamed html", f("notes.txt", "  <!DOCTYPE html><html><script>alert(1)</script>")],
      ["svg", f("fig.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>")],
      ["renamed svg", f("fig.png", "<?xml version='1.0'?><svg></svg>")],
      ["javascript", f("run.js", "alert(1)")],
      ["batch", f("go.bat", "@echo off")],
      ["double extension", f("notes.pdf.exe", "x")],
    ];
    for (const [label, file] of bad) expect(() => submitNote(s, noText(), [file]), label).toThrow(/not accepted|looks like/i);
    expect(onDisk()).toEqual([]);
    expect(count("SELECT COUNT(*) AS n FROM resource_note")).toBe(0);
  });

  it("does not mistake a plain text file that starts with MZ for a program", () => {
    const s = makeUser(db, "Student");
    expect(() => submitNote(s, noText(), [f("initials.txt", "MZ are my initials, and these are my notes about recursion.")])).not.toThrow();
  });

  it("enforces file count, size, empty-file and total-size limits", () => {
    const s = makeUser(db, "Student");
    expect(() => submitNote(s, noText(), [])).toThrow(/at least one file/i);
    expect(() => submitNote(s, noText(), Array.from({ length: 6 }, (_, i) => f(`n${i}.pdf`)))).toThrow(/at most 5/i);
    expect(() => submitNote(s, noText(), [f("empty.pdf", new Uint8Array(0))])).toThrow(/empty/i);
    expect(() => submitNote(s, noText(), [f("huge.pdf", new Uint8Array(15 * MB + 1))])).toThrow(/larger than 15 MB/i);
    expect(() => submitNote(s, noText(), [f("a.pdf", new Uint8Array(14 * MB)), f("b.pdf", new Uint8Array(14 * MB)), f("c.pdf", new Uint8Array(14 * MB))])).toThrow(/together/i);
    expect(onDisk()).toEqual([]);
    expect(count("SELECT COUNT(*) AS n FROM resource_note")).toBe(0);
  });

  it("applies a per-person storage quota and a global cap that protects the volume, while pasted text still works", () => {
    const s = makeUser(db, "Student");
    const big = () => f("scan.pdf", new Uint8Array(14 * MB).fill(65));
    for (let i = 0; i < 7; i++) submitNote(s, noText({ title: `Scan ${i}` }), [big()]); // 98 MB
    expect(() => submitNote(s, noText({ title: "One more" }), [big()])).toThrow(/up to 100 MB/i);
    for (const n of listMyNotes(s)) deleteMyNote(s, n.id);

    process.env.NOTES_MAX_TOTAL_MB = "1";
    const t = makeUser(db, "Other");
    expect(() => submitNote(t, noText(), [f("two-mb.pdf", new Uint8Array(2 * MB).fill(66))])).toThrow(/storage is full/i);
    expect(() => submitNote(t, note())).not.toThrow(); // text-only notes are unaffected
  });

  it("cleans a stored file off disk when anything fails after it was written", () => {
    const s = makeUser(db, "Student");
    db.exec("DROP TABLE note_file");
    expect(() => submitNote(s, noText(), [f("a.pdf")])).toThrow();
    expect(onDisk()).toEqual([]);
  });

  it("cleans up a name containing a path, control characters or personal details", () => {
    const s = makeUser(db, "Student");
    submitNote(s, noText({ title: "Names" }), [f("../../etc/pass\u0000wd notes.txt", "x notes")]);
    expect(listMyNotes(s)[0].files[0].name).toBe("passwd notes.txt");
    expect(() => submitNote(s, noText({ title: "Mail" }), [f("jane.doe@example.com notes.pdf")])).toThrow(/email address/);
    submitNote(s, noText({ title: "Long" }), [f("x".repeat(400) + ".pdf")]);
    expect(listMyNotes(s).find((n) => n.title === "Long")!.files[0].name.length).toBeLessThanOrEqual(150);
  });
});

describe("files are removed everywhere a note is removed", () => {
  const upload = (db2: DB) => {
    const s = makeUser(db2, "Student");
    const r = submitNote(s, noText(), [f("a.pdf"), f("b.pdf", "second file")]);
    return { s, ...r };
  };

  it("when the author deletes the note", () => {
    const { s, id } = upload(db);
    expect(onDisk()).toHaveLength(2);
    deleteMyNote(s, id);
    expect(onDisk()).toEqual([]);
    expect(count("SELECT COUNT(*) AS n FROM note_file")).toBe(0);
  });

  it("when a maintainer deletes the note", () => {
    const maint = makeUser(db, "Maintainer", "maintainer");
    const { id } = upload(db);
    deleteNoteAsMaintainer(maint, id);
    expect(onDisk()).toEqual([]);
  });

  it("when the note expires", () => {
    const { id } = upload(db);
    db.prepare("UPDATE resource_note SET created_at = ? WHERE id = ?").run(new Date(Date.now() - (NOTES_RETENTION_DAYS + 1) * 86_400_000).toISOString(), id);
    expect(purgeExpiredNotes(db)).toBe(1);
    expect(onDisk()).toEqual([]);
  });

  it("when the account is deleted", () => {
    const { s } = upload(db);
    deleteAccount(s.id);
    expect(onDisk()).toEqual([]);
    expect(count("SELECT COUNT(*) AS n FROM note_file")).toBe(0);
  });

  it("sweeps stray files that no database row refers to, but never a young one or a real one", () => {
    const { id } = upload(db);
    const real = onDisk();
    const strayOld = path.join(dir, crypto.randomUUID());
    const strayNew = path.join(dir, crypto.randomUUID());
    fs.writeFileSync(strayOld, "left behind");
    fs.writeFileSync(strayNew, "upload in progress");
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(strayOld, old, old);
    sweepOrphanNoteFiles(db, true);
    expect(fs.existsSync(strayOld)).toBe(false);
    expect(fs.existsSync(strayNew)).toBe(true);
    expect(onDisk().filter((n) => real.includes(n))).toHaveLength(2);
    expect(count("SELECT COUNT(*) AS n FROM note_file WHERE note_id = ?", id)).toBe(2);
  });
});
