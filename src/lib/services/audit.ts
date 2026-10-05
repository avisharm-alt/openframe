import { getDb, uid, now } from "../db";
import type { Actor } from "../types";
import { requireAdmin, requireCoordinator } from "./access";

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

export type AuditRow = { id: string; at: string; action: string; actorName: string | null; chapterId: string | null; subjectType: string | null; subjectId: string | null; detail: Record<string, unknown> };

/**
 * Reads the audit log. Admins see everything; a chapter's coordinators see that chapter's events
 * (including who viewed which pickup address). Nobody else can read it.
 */
export function listAudit(actor: Actor, opts: { chapterId?: string; action?: string; limit?: number } = {}): AuditRow[] {
  if (opts.chapterId) requireCoordinator(actor, opts.chapterId);
  else requireAdmin(actor);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.chapterId) { where.push("e.chapter_id = ?"); params.push(opts.chapterId); }
  if (opts.action) { where.push("e.action = ?"); params.push(opts.action); }
  const rows = getDb()
    .prepare(
      `SELECT e.id, e.created_at AS at, e.action, u.name AS actorName, e.chapter_id AS chapterId, e.subject_type AS subjectType, e.subject_id AS subjectId, e.detail
         FROM audit_event e LEFT JOIN "user" u ON u.id = e.actor_id ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`,
    )
    .all(...params, Math.min(Math.max(opts.limit ?? 100, 1), 500)) as (Omit<AuditRow, "detail"> & { detail: string })[];
  return rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) as Record<string, unknown> }));
}
