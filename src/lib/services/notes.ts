import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, uid, now, type DB } from "../db";
import {
  NOTES_AI_CONSENT_TEXT, NOTES_CONSENT_VERSION, NOTES_MAX_FILES, NOTES_MAX_FILE_BYTES, NOTES_MAX_REQUEST_BYTES, NOTES_MIN_CHARS, NOTES_OWN_WORK_TEXT, NOTES_RETENTION_DAYS,
} from "../attestation";
import { config } from "../config";
import { ServiceError, forbidden, invalid, notFound } from "../errors";
import { inspectFile } from "../note-files";
import { isMaintainer, type Actor } from "../types";
import { noteSchema, personalInfoProblems, textFlags } from "../validation";
import { logEvent } from "./events";

/**
 * Private study notes shared so volunteers can write practice questions from them.
 * Notes are never returned by any learner-facing or public route and never published. The author sees only title and status; the
 * full text is readable by maintainers only, and each time one is opened an audit event is written (without the text).
 */

/** Cap on stored notes per person, so one account cannot fill the database. */
export const MAX_NOTES_PER_USER = 20;
/** Cap on stored file bytes per person. The global cap (config.notesMaxTotalBytes) protects the volume that holds the database. */
export const NOTES_USER_QUOTA_BYTES = 100 * 1024 * 1024;
export type IncomingFile = { name: string; bytes: Uint8Array };

// ---------- file storage (bytes on disk, named by id; metadata in note_file) ----------
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const filePath = (id: string) => path.join(config.notesDir, id);
function unlinkFiles(ids: string[]) {
  for (const id of ids) {
    try { if (ID_RE.test(id)) fs.unlinkSync(filePath(id)); } catch { /* already gone */ }
  }
}
let lastSweep = 0;
/**
 * Removes files on disk that no database row refers to (left behind by crashes, or by deleting an account, whose rows are removed by the
 * database). Throttled (`force` only skips the throttle); files younger than a few minutes are left alone so an upload in progress is never touched.
 */
export function sweepOrphanNoteFiles(db: DB = getDb(), force = false) {
  if (!force && Date.now() - lastSweep < 10 * 60_000) return;
  lastSweep = Date.now();
  let names: string[];
  try { names = fs.readdirSync(config.notesDir); } catch { return; }
  const known = new Set((db.prepare("SELECT id FROM note_file").all() as { id: string }[]).map((r) => r.id));
  for (const name of names) {
    const p = path.join(config.notesDir, name);
    try {
      const age = Date.now() - fs.statSync(p).mtimeMs;
      const stray = name.startsWith(".") ? age > 3_600_000 : ID_RE.test(name) && !known.has(name) && age > 300_000;
      if (stray) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }
}
const filesOf = (db: DB, noteId: string) =>
  db.prepare("SELECT id, original_name AS name, size FROM note_file WHERE note_id = ? ORDER BY rowid").all(noteId) as { id: string; name: string; size: number }[];
/** Ids of every file belonging to a person's notes. Used before deleting an account, whose database rows are removed with it. */
export const noteFileIdsForUser = (userId: string, db: DB = getDb()) =>
  (db.prepare("SELECT f.id FROM note_file f JOIN resource_note n ON n.id = f.note_id WHERE n.user_id = ?").all(userId) as { id: string }[]).map((r) => r.id);
export const unlinkNoteFiles = unlinkFiles;
export const NOTE_STATUSES = ["new", "used", "declined"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

const PERSONAL_INFO_LABEL = { email: "an email address", phone: "a phone number", student_number: "a student number" } as const;
const expiryOf = (createdAt: string) => new Date(Date.parse(createdAt) + NOTES_RETENTION_DAYS * 86_400_000).toISOString();

/**
 * Deletes notes older than the retention period. Called before every note read or write, so the promise made to students holds
 * without depending on someone scheduling a cron job.
 */
export function purgeExpiredNotes(db: DB = getDb()): number {
  const cutoff = new Date(Date.now() - NOTES_RETENTION_DAYS * 86_400_000).toISOString();
  const ids = (db.prepare("SELECT f.id FROM note_file f JOIN resource_note n ON n.id = f.note_id WHERE n.created_at < ?").all(cutoff) as { id: string }[]).map((r) => r.id);
  const removed = db.prepare("DELETE FROM resource_note WHERE created_at < ?").run(cutoff).changes;
  unlinkFiles(ids);
  sweepOrphanNoteFiles(db);
  return removed;
}

export function submitNote(actor: Actor, raw: unknown, files: IncomingFile[] = []) {
  const db = getDb();
  const d = noteSchema.parse(raw);
  purgeExpiredNotes(db);
  const course = db
    .prepare("SELECT 1 FROM course c JOIN university u ON u.id = c.university_id WHERE c.id = ? AND c.status = 'active' AND u.enabled = 1")
    .get(d.courseId);
  if (!course) throw invalid("That course is not available.");
  if (files.length === 0 && d.text.length < NOTES_MIN_CHARS) {
    throw invalid(`Paste your notes (at least ${NOTES_MIN_CHARS} characters) or attach at least one file.`);
  }
  if (files.length > NOTES_MAX_FILES) throw invalid(`You can attach at most ${NOTES_MAX_FILES} files to one note.`);
  const names = files.map((f) => inspectFile(f.name, f.bytes)); // also rejects empty and not-accepted files
  const problems = personalInfoProblems(`${d.title}\n${d.text}\n${names.join("\n")}`);
  if (problems.length) {
    throw new ServiceError(422, "personal_info", `Your notes seem to include ${problems.map((p) => PERSONAL_INFO_LABEL[p]).join(" and ")}. Please remove personal details and send them again.`, { problems });
  }
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM resource_note WHERE user_id = ?").get(actor.id) as { n: number }).n;
  if (mine >= MAX_NOTES_PER_USER) {
    throw new ServiceError(429, "too_many_notes", `You already have ${mine} notes stored. Delete some, or wait for them to be used, before sending more.`);
  }
  let total = 0;
  for (const f of files) {
    if (f.bytes.length > NOTES_MAX_FILE_BYTES) throw invalid(`“${f.name}” is larger than ${NOTES_MAX_FILE_BYTES / 1048576} MB. Split it or send a smaller file.`);
    total += f.bytes.length;
  }
  if (total > NOTES_MAX_REQUEST_BYTES) throw invalid(`The files together are larger than ${NOTES_MAX_REQUEST_BYTES / 1048576} MB.`);
  if (total > 0) {
    const used = (db.prepare("SELECT COALESCE(SUM(f.size), 0) AS n FROM note_file f JOIN resource_note n ON n.id = f.note_id WHERE n.user_id = ?").get(actor.id) as { n: number }).n;
    if (used + total > NOTES_USER_QUOTA_BYTES) {
      throw new ServiceError(429, "storage_quota", `You can keep up to ${NOTES_USER_QUOTA_BYTES / 1048576} MB of files. Delete some notes first.`);
    }
    const all = (db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM note_file").get() as { n: number }).n;
    if (all + total > config.notesMaxTotalBytes) {
      throw new ServiceError(503, "storage_full", "File storage is full right now, so files cannot be accepted. You can still paste your notes as text, or try again later.");
    }
  }

  const id = uid();
  const t = now();
  const stored: { id: string; name: string; size: number; sha: string }[] = [];
  try {
    if (files.length) fs.mkdirSync(config.notesDir, { recursive: true, mode: 0o700 });
    files.forEach((f, i) => {
      const fid = uid();
      const tmp = path.join(config.notesDir, `.${fid}.tmp`);
      fs.writeFileSync(tmp, f.bytes, { mode: 0o600 });
      fs.renameSync(tmp, filePath(fid));
      stored.push({ id: fid, name: names[i], size: f.bytes.length, sha: crypto.createHash("sha256").update(f.bytes).digest("hex") });
    });
    db.transaction(() => {
      db.prepare(
        `INSERT INTO resource_note (id, user_id, course_id, title, body, status, flags, consent_version, consent_text, consented_at, created_at)
         VALUES (?,?,?,?,?, 'new', ?, ?, ?, ?, ?)`,
      ).run(id, actor.id, d.courseId, d.title, d.text, JSON.stringify(textFlags(d.text)), NOTES_CONSENT_VERSION, `${NOTES_OWN_WORK_TEXT}\n${NOTES_AI_CONSENT_TEXT}`, t, t);
      const ins = db.prepare("INSERT INTO note_file (id, note_id, original_name, size, sha256, created_at) VALUES (?,?,?,?,?,?)");
      for (const f of stored) ins.run(f.id, id, f.name, f.size, f.sha, t);
    })();
  } catch (e) {
    unlinkFiles(stored.map((f) => f.id)); // nothing is left behind if anything above failed
    throw e;
  }
  logEvent(actor.id, "note_submitted", { detail: { noteId: id, chars: d.text.length, files: stored.length, bytes: total } });
  return { id, expiresAt: expiryOf(t) };
}

export type MyNote = { id: string; title: string; courseCode: string; status: NoteStatus; createdAt: string; expiresAt: string; chars: number; files: { name: string; size: number }[] };

/** The author's own list. Deliberately has no note text: authors already have their copy, and less text moving is safer. */
export function listMyNotes(actor: Actor): MyNote[] {
  const db = getDb();
  purgeExpiredNotes(db);
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.status, n.created_at AS createdAt, length(n.body) AS chars, c.code AS courseCode
       FROM resource_note n JOIN course c ON c.id = n.course_id WHERE n.user_id = ? ORDER BY n.created_at DESC`,
    )
    .all(actor.id) as Omit<MyNote, "expiresAt" | "files">[];
  return rows.map((r) => ({ ...r, expiresAt: expiryOf(r.createdAt), files: filesOf(db, r.id).map(({ name, size }) => ({ name, size })) }));
}

/** Authors can delete their own notes at any time. Other people's notes are a 404 so ids cannot be probed. */
export function deleteMyNote(actor: Actor, id: string) {
  const db = getDb();
  purgeExpiredNotes(db);
  const ids = (db.prepare("SELECT f.id FROM note_file f JOIN resource_note n ON n.id = f.note_id WHERE n.id = ? AND n.user_id = ?").all(id, actor.id) as { id: string }[]).map((r) => r.id);
  const r = db.prepare("DELETE FROM resource_note WHERE id = ? AND user_id = ?").run(id, actor.id);
  if (!r.changes) throw notFound("Note not found");
  unlinkFiles(ids);
  logEvent(actor.id, "note_deleted_by_author", { detail: { noteId: id } });
  return { id };
}

function requireMaintainer(actor: Actor) {
  if (!isMaintainer(actor)) throw forbidden("Maintainer access required.");
}

export type ReviewNoteRow = Omit<MyNote, "files"> & { authorName: string | null; flags: string[]; fileCount: number };

export function listNotesForReview(actor: Actor): ReviewNoteRow[] {
  requireMaintainer(actor);
  const db = getDb();
  purgeExpiredNotes(db);
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.status, n.flags, n.created_at AS createdAt, length(n.body) AS chars, c.code AS courseCode, u.name AS authorName,
              (SELECT COUNT(*) FROM note_file f WHERE f.note_id = n.id) AS fileCount
       FROM resource_note n JOIN course c ON c.id = n.course_id LEFT JOIN "user" u ON u.id = n.user_id
       ORDER BY (n.status = 'new') DESC, n.created_at DESC`,
    )
    .all() as (Omit<ReviewNoteRow, "expiresAt" | "flags"> & { flags: string })[];
  return rows.map((r) => ({ ...r, flags: JSON.parse(r.flags) as string[], expiresAt: expiryOf(r.createdAt) }));
}

/** Full text, for maintainers only. Opening a note is recorded in the audit log (who and which note, never the text). */
export function getNoteForReview(actor: Actor, id: string) {
  requireMaintainer(actor);
  const db = getDb();
  purgeExpiredNotes(db);
  const n = db
    .prepare(
      `SELECT n.id, n.title, n.body AS text, n.status, n.flags, n.created_at AS createdAt, n.consent_version AS consentVersion, n.consented_at AS consentedAt,
              c.code AS courseCode, c.title AS courseTitle, u.name AS authorName
       FROM resource_note n JOIN course c ON c.id = n.course_id LEFT JOIN "user" u ON u.id = n.user_id WHERE n.id = ?`,
    )
    .get(id) as (Omit<ReviewNoteRow, "expiresAt" | "flags" | "chars" | "fileCount"> & { text: string; flags: string; consentVersion: string; consentedAt: string; courseTitle: string }) | undefined;
  if (!n) throw notFound("Note not found");
  logEvent(actor.id, "note_opened", { detail: { noteId: id } });
  return { ...n, flags: JSON.parse(n.flags) as string[], chars: n.text.length, expiresAt: expiryOf(n.createdAt), files: filesOf(db, id) };
}

export function setNoteStatus(actor: Actor, id: string, status: string) {
  requireMaintainer(actor);
  if (!(NOTE_STATUSES as readonly string[]).includes(status)) throw invalid("Unknown status.");
  const db = getDb();
  purgeExpiredNotes(db);
  const r = db.prepare("UPDATE resource_note SET status = ? WHERE id = ?").run(status, id);
  if (!r.changes) throw notFound("Note not found");
  logEvent(actor.id, "note_status", { detail: { noteId: id, status } });
  return { id, status };
}

export function deleteNoteAsMaintainer(actor: Actor, id: string) {
  requireMaintainer(actor);
  const db = getDb();
  const ids = (db.prepare("SELECT id FROM note_file WHERE note_id = ?").all(id) as { id: string }[]).map((r) => r.id);
  const r = db.prepare("DELETE FROM resource_note WHERE id = ?").run(id);
  if (!r.changes) throw notFound("Note not found");
  unlinkFiles(ids);
  logEvent(actor.id, "note_deleted_by_maintainer", { detail: { noteId: id } });
  return { id };
}

/** Maintainers only: the bytes of one uploaded file. Every download is written to the audit log (who and which file, not content). */
export function readNoteFile(actor: Actor, noteId: string, fileId: string): { name: string; bytes: Buffer } {
  requireMaintainer(actor);
  const db = getDb();
  purgeExpiredNotes(db);
  const f = db.prepare("SELECT id, original_name AS name FROM note_file WHERE id = ? AND note_id = ?").get(fileId, noteId) as { id: string; name: string } | undefined;
  if (!f || !ID_RE.test(f.id)) throw notFound("File not found");
  let bytes: Buffer;
  try { bytes = fs.readFileSync(filePath(f.id)); } catch { throw notFound("File not found"); }
  logEvent(actor.id, "note_file_downloaded", { detail: { noteId, fileId } });
  return { name: f.name, bytes };
}
