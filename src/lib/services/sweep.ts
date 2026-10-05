import { getDb, now } from "../db";
import { config } from "../config";
import { addDays, localDate, nowDate } from "../time";
import { logAudit } from "./audit";
import { releaseStaleClaims } from "./claims";
import { notifyCoordinatorsAtRisk } from "./notifications";
import { notifyOverduePickups } from "./pickups";
import { syncRestock } from "./restock";
import { sendShiftReminders } from "./shifts";

export const EXPIRE_AFTER_DAYS = 7;

/** Open requests whose needed-by date passed more than a week ago, with nothing in flight, expire. */
export function expireRequests(at: Date = nowDate()): number {
  const db = getDb();
  let n = 0;
  const rows = db
    .prepare(
      `SELECT q.id, q.needed_by AS neededBy, c.timezone, c.id AS chapterId FROM request q JOIN chapter c ON c.id = q.chapter_id
        WHERE q.status = 'open' AND NOT EXISTS (SELECT 1 FROM claim cl WHERE cl.request_id = q.id AND cl.status IN ('claimed','scheduled','collected'))`,
    )
    .all() as { id: string; neededBy: string; timezone: string; chapterId: string }[];
  for (const r of rows) {
    if (r.neededBy < addDays(localDate(r.timezone, at), -EXPIRE_AFTER_DAYS)) {
      db.prepare("UPDATE request SET status = 'expired', status_reason = 'Needed-by date passed', updated_at = ? WHERE id = ?").run(now(), r.id);
      logAudit(null, "request_expired", { chapterId: r.chapterId, subjectType: "request", subjectId: r.id });
      n++;
    }
  }
  return n;
}

/** Alerts a chapter's coordinators once when an unfilled request is close to (or past) its needed-by date. */
export function notifyAtRisk(at: Date = nowDate()): number {
  const db = getDb();
  let n = 0;
  const rows = db
    .prepare(
      `SELECT q.id, q.needed_by AS neededBy, c.timezone FROM request q JOIN chapter c ON c.id = q.chapter_id
        WHERE q.status IN ('open','claimed') AND q.type <> 'restock' AND q.risk_notified_at IS NULL`,
    )
    .all() as { id: string; neededBy: string; timezone: string }[];
  for (const r of rows) {
    if (r.neededBy <= addDays(localDate(r.timezone, at), config.requestRiskDays)) {
      db.prepare("UPDATE request SET risk_notified_at = ? WHERE id = ?").run(at.toISOString(), r.id);
      notifyCoordinatorsAtRisk(r.id);
      n++;
    }
  }
  return n;
}

export type SweepResult = { released: number; expired: number; restockPosted: number; atRisk: number; overdue: number; reminders: number };

/**
 * The 15-minute housekeeping job (`npm run admin:sweep`): release claims that were not scheduled within 48 hours,
 * expire stale requests, keep restock requests in step with stock, alert coordinators about at-risk requests and overdue
 * pickups, and send shift reminders. Each step is idempotent, so running it more often is harmless.
 */
export function sweep(at: Date = nowDate()): SweepResult {
  const released = releaseStaleClaims(at);
  const expired = expireRequests(at);
  let restockPosted = 0;
  for (const c of getDb().prepare("SELECT id FROM chapter WHERE active = 1").all() as { id: string }[]) restockPosted += syncRestock(c.id, at).posted;
  return { released, expired, restockPosted, atRisk: notifyAtRisk(at), overdue: notifyOverduePickups(at), reminders: sendShiftReminders(at) };
}
