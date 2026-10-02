import { getDb, now } from "../db";
import { notFound } from "../errors";
import type { Actor } from "../types";
import { PUBLISHED } from "./catalog";

export function addBookmark(actor: Actor, questionId: string) {
  const db = getDb();
  const ok = db.prepare(`SELECT 1 FROM question q WHERE q.id = ? AND ${PUBLISHED}`).get(questionId);
  if (!ok) throw notFound("Question not found");
  db.prepare("INSERT OR IGNORE INTO bookmark (user_id, question_id, created_at) VALUES (?,?,?)").run(actor.id, questionId, now());
  return { bookmarked: true };
}

export function removeBookmark(actor: Actor, questionId: string) {
  getDb().prepare("DELETE FROM bookmark WHERE user_id = ? AND question_id = ?").run(actor.id, questionId);
  return { bookmarked: false };
}

/** Only currently published questions are returned; withdrawn ones silently disappear. */
export function listBookmarks(actor: Actor) {
  return getDb()
    .prepare(
      `SELECT q.id, c.code AS courseCode, c.slug AS courseSlug, t.title AS topic, r.stem, r.difficulty, r.review_status AS reviewStatus
       FROM bookmark b JOIN question q ON q.id = b.question_id AND ${PUBLISHED}
       JOIN question_revision r ON r.id = q.live_revision_id
       JOIN course c ON c.id = q.course_id JOIN topic t ON t.id = q.topic_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    )
    .all(actor.id) as { id: string; courseCode: string; courseSlug: string; topic: string; stem: string; difficulty: string | null; reviewStatus: string }[];
}

export function bookmarkedIds(actor: Actor | null): Set<string> {
  if (!actor) return new Set();
  return new Set((getDb().prepare("SELECT question_id FROM bookmark WHERE user_id = ?").all(actor.id) as { question_id: string }[]).map((r) => r.question_id));
}
