import { getDb, uid, now } from "../db";
import { forbidden, invalid, notFound, ServiceError } from "../errors";
import { isReviewer, type Actor } from "../types";

export const MAX_NOTE_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE_REQUEST_BYTES = MAX_NOTE_BYTES + 64 * 1024;
export type NoteSummary = { id: string; filename: string; courseCode: string; sizeBytes: number; createdAt: string };

export function saveCourseNote(actor: Actor, courseId: string, filename: string, content: Buffer, permission: boolean) {
  if (!permission) throw invalid("Confirm that you can share these notes with OpenFrame.");
  if (!content.length || content.length > MAX_NOTE_BYTES) throw invalid("Choose a non-empty file up to 10 MB.");
  const name = filename.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 180);
  if (/\.pdf$/i.test(name) && content.subarray(0, 5).toString() === "%PDF-") {
    // Store only; never render or execute uploaded PDFs.
  } else if (/\.txt$/i.test(name)) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(content); } catch { throw invalid("Text files must use UTF-8 encoding."); }
    if (content.includes(0)) throw invalid("Choose a plain text file.");
  } else throw invalid("Choose a PDF or plain text (.txt) file.");
  const db = getDb();
  return db.transaction(() => {
    if (!db.prepare("SELECT c.id FROM course c JOIN university u ON u.id=c.university_id WHERE c.id=? AND c.status='active' AND u.enabled=1").get(courseId)) throw invalid("Choose an available course.");
    const total = (db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS n FROM course_note WHERE owner_id=?").get(actor.id) as { n: number }).n;
    if (total + content.length > 50 * 1024 * 1024) throw new ServiceError(413, "quota", "Your notes storage limit is 50 MB. Remove an upload before adding more.");
    const id = uid();
    db.prepare("INSERT INTO course_note VALUES (?,?,?,?,?,?,?)").run(id, actor.id, courseId, name, content.length, content, now());
    return { id, filename: name };
  }).immediate();
}

export function listCourseNotes(actor: Actor, team = false): NoteSummary[] {
  if (team && !isReviewer(actor)) throw forbidden();
  return getDb().prepare("SELECT n.id, n.filename, c.code AS courseCode, n.size_bytes AS sizeBytes, n.created_at AS createdAt FROM course_note n JOIN course c ON c.id=n.course_id " + (team ? "" : "WHERE n.owner_id=? ") + "ORDER BY n.created_at DESC LIMIT 200").all(...(team ? [] : [actor.id])) as NoteSummary[];
}

export function readCourseNote(actor: Actor, id: string) {
  const row = getDb().prepare("SELECT * FROM course_note WHERE id=?").get(id) as { owner_id: string; filename: string; content: Buffer } | undefined;
  if (!row) throw notFound("Upload not found.");
  if (row.owner_id !== actor.id && !isReviewer(actor)) throw forbidden();
  return row;
}

export function deleteCourseNote(actor: Actor, id: string) {
  readCourseNote(actor, id);
  getDb().prepare("DELETE FROM course_note WHERE id=?").run(id);
  return { deleted: true };
}
