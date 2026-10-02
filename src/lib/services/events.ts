import { getDb, uid, now } from "../db";

/** Append-only moderation audit. `detail` must never hold personal data or private reviewer notes. */
export function logEvent(
  actorId: string | null,
  action: string,
  refs: { questionId?: string | null; revisionId?: string | null; reportId?: string | null; detail?: Record<string, unknown> } = {},
) {
  getDb()
    .prepare("INSERT INTO moderation_event (id, actor_id, action, question_id, revision_id, report_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(uid(), actorId, action, refs.questionId ?? null, refs.revisionId ?? null, refs.reportId ?? null, JSON.stringify(refs.detail ?? {}), now());
}
