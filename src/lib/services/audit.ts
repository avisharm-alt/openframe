import { getDb, uid, now } from "../db";

export type AuditRefs = {
  chapterId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * Append-only audit trail (enforced by triggers in migration 006).
 * `detail` must never hold an address, phone number, access note or any other personal data.
 */
export function logAudit(actorId: string | null, action: string, refs: AuditRefs = {}) {
  getDb()
    .prepare("INSERT INTO audit_event (id, actor_id, action, chapter_id, subject_type, subject_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(uid(), actorId, action, refs.chapterId ?? null, refs.subjectType ?? null, refs.subjectId ?? null, JSON.stringify(refs.detail ?? {}), now());
}
