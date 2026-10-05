import { getDb, now, uid } from "../db";
import { config } from "../config";
import { decryptField } from "../crypto";
import { ServiceError, conflict, forbidden, invalid, notFound } from "../errors";
import { rateLimit } from "../ratelimit";
import { hoursFrom, localDate, nowDate } from "../time";
import { assignSchema, completeSchema, confirmWindowSchema } from "../validation";
import type { Actor, PledgeStatus } from "../types";
import { logAudit } from "./audit";
import { getChapter, isCoordinatorOf, isVolunteerOf, requireCoordinator } from "./access";
import { insertConcern } from "./concerns";
import { notifyCollected, notifyCoordinatorsOverdue, notifyPickupScheduled, notifyVolunteerAssigned } from "./notifications";
import { applyTransition, pickupWindows, type WindowView } from "./pledges";
import { safetyAcknowledgedAt } from "./safety";

export const MAX_VOLUNTEERS = 4;
const OPEN: PledgeStatus[] = ["pledged", "scheduled"];

type Ctx = {
  id: string; pledge_id: string; chapter_id: string; address_enc: string | null; notes_enc: string | null; phone_enc: string | null;
  purged_at: string | null; scheduled_window_id: string | null; overdue_notified_at: string | null;
  donor_id: string | null; status: PledgeStatus;
};
function loadPickup(id: string): Ctx {
  const r = getDb()
    .prepare("SELECT k.*, p.donor_id, p.status FROM pickup k JOIN pledge p ON p.id = k.pledge_id WHERE k.id = ?")
    .get(id) as Ctx | undefined;
  if (!r) throw notFound("Pickup not found");
  return r;
}
const assignedCount = (pickupId: string) =>
  (getDb().prepare("SELECT COUNT(*) AS n FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id IS NOT NULL").get(pickupId) as { n: number }).n;

/** The confirmed window, or the donor's earliest preferred window while none is confirmed. */
function referenceWindow(k: Ctx): { start: Date; end: Date; confirmed: boolean } | null {
  const ws = pickupWindows(k.id);
  const w = (k.scheduled_window_id && ws.find((x) => x.id === k.scheduled_window_id)) || ws[0];
  return w ? { start: new Date(w.startAt), end: new Date(w.endAt), confirmed: !!k.scheduled_window_id } : null;
}

// ---- who can see the address, and when ------------------------------------------------------------------------------

export type AddressAccess = {
  allowed: boolean;
  as?: "donor" | "volunteer" | "coordinator";
  reason?: "not_related" | "purged" | "closed" | "not_yet" | "not_scheduled";
  visibleFrom?: string;
};

/**
 * The single rule for who may see a pickup's private details.
 * - Only the donor, the coordinators of that chapter (and admins) and volunteers assigned to this pickup. Nobody else.
 * - Coordinators and volunteers: only from 24 hours before the window until the pickup is closed (collected,
 *   cancelled or no-show). Volunteers additionally only once the pickup is scheduled with its two volunteers.
 * - The donor can always see what they submitted until the details are purged.
 * - Nobody, including the donor, once the details have been purged.
 */
export function addressAccess(actor: Actor, pickupId: string, at: Date = nowDate()): AddressAccess {
  const k = loadPickup(pickupId);
  const isDonor = k.donor_id === actor.id;
  const assigned = !!getDb().prepare("SELECT 1 FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id = ?").get(pickupId, actor.id);
  const coord = isCoordinatorOf(actor, k.chapter_id);
  if (!isDonor && !assigned && !coord) return { allowed: false, reason: "not_related" };
  if (k.purged_at) return { allowed: false, reason: "purged" };
  const w = referenceWindow(k);
  const visibleFrom = w ? hoursFrom(w.start, -config.pickupVisibleHoursBefore) : null;
  const base = visibleFrom ? { visibleFrom: visibleFrom.toISOString() } : {};
  if (isDonor) return { allowed: true, as: "donor", ...base };
  if (!OPEN.includes(k.status)) return { allowed: false, reason: "closed", ...base };
  if (!visibleFrom || at < visibleFrom) return { allowed: false, reason: "not_yet", ...base };
  if (coord) return { allowed: true, as: "coordinator", ...base };
  if (k.status !== "scheduled") return { allowed: false, reason: "not_scheduled", ...base };
  return { allowed: true, as: "volunteer", ...base };
}

export type PickupDetails = { pickupId: string; pledgeId: string; address: string; notes: string; phone: string; viewedAs: "donor" | "volunteer" | "coordinator" };

/**
 * The only function that decrypts pickup details. Every call that returns them writes an audit event
 * (who, which pickup, in which capacity; never the details themselves), and views are rate limited.
 */
export function viewPickupDetails(actor: Actor, pickupId: string, at: Date = nowDate()): PickupDetails {
  rateLimit(`address:${actor.id}`, 60, 3600_000);
  const k = loadPickup(pickupId);
  const a = addressAccess(actor, pickupId, at);
  if (!a.allowed) {
    if (a.reason === "not_related") throw notFound("Pickup not found");
    logAudit(actor.id, "address_view_denied", { chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId, detail: { reason: a.reason } });
    if (a.reason === "purged") throw new ServiceError(410, "details_purged", "These pickup details were erased after the pickup was finished.");
    if (a.reason === "closed") throw forbidden("This pickup is closed, so its address is no longer shown.");
    if (a.reason === "not_scheduled") throw new ServiceError(403, "not_scheduled", "The address is shown once the pickup is scheduled with two volunteers.");
    throw new ServiceError(403, "not_yet_visible", `The address is shown starting ${config.pickupVisibleHoursBefore} hours before the pickup window.`, { visibleFrom: a.visibleFrom });
  }
  if (!k.address_enc) throw new ServiceError(410, "details_purged", "These pickup details were erased after the pickup was finished.");
  const details: PickupDetails = {
    pickupId, pledgeId: k.pledge_id, viewedAs: a.as!,
    address: decryptField(k.address_enc, k.id),
    notes: k.notes_enc ? decryptField(k.notes_enc, k.id) : "",
    phone: k.phone_enc ? decryptField(k.phone_enc, k.id) : "",
  };
  logAudit(actor.id, "address_viewed", { chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId, detail: { as: a.as } });
  return details;
}

// ---- assignments and scheduling -------------------------------------------------------------------------------------

/** Moves a pickup to `scheduled` once a window is confirmed and two volunteers are assigned. Runs inside the caller's transaction. */
function trySchedule(k: Ctx): boolean {
  const cur = loadPickup(k.id);
  if (cur.status !== "pledged" || !cur.scheduled_window_id || assignedCount(k.id) < 2) return false;
  applyTransition(cur.pledge_id, "scheduled", "Window confirmed and two volunteers assigned");
  return true;
}

function addAssignment(k: Ctx, volunteerId: string, assignedBy: string) {
  if (!OPEN.includes(k.status)) throw conflict("pickup_closed", "This pickup is closed.");
  if (k.donor_id === volunteerId) throw invalid("Nobody can be assigned to their own pickup.");
  if (assignedCount(k.id) >= MAX_VOLUNTEERS) throw conflict("too_many_volunteers", `A pickup can have at most ${MAX_VOLUNTEERS} volunteers.`);
  if (!safetyAcknowledgedAt(volunteerId)) throw conflict("safety_not_acknowledged", "This volunteer has not acknowledged the Safety rules yet. They need to do that before their first assignment.");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id = ?").get(k.id, volunteerId)) throw conflict("already_assigned", "That volunteer is already assigned to this pickup.");
  db.prepare("INSERT INTO pickup_assignment (id, pickup_id, volunteer_id, assigned_by, assigned_at) VALUES (?,?,?,?,?)").run(uid(), k.id, volunteerId, assignedBy, now());
}

/** A coordinator assigns a volunteer of the same chapter. Once a window is confirmed and two are assigned the pledge becomes scheduled. */
export function assignVolunteer(actor: Actor, pickupId: string, raw: unknown) {
  const k = loadPickup(pickupId);
  requireCoordinator(actor, k.chapter_id);
  const { volunteerId } = assignSchema.parse(raw);
  const vol = getDb().prepare("SELECT role FROM chapter_member WHERE chapter_id = ? AND user_id = ?").get(k.chapter_id, volunteerId);
  if (!vol) throw invalid("That person is not a volunteer in this chapter.");
  let scheduled = false;
  getDb().transaction(() => {
    addAssignment(k, volunteerId, actor.id);
    scheduled = trySchedule(k);
  })();
  logAudit(actor.id, "volunteer_assigned", { chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId, detail: { volunteerId } });
  notifyVolunteerAssigned(pickupId, volunteerId);
  if (scheduled) notifyPickupScheduled(k.pledge_id);
  return { scheduled };
}

export function unassignVolunteer(actor: Actor, pickupId: string, volunteerId: string) {
  const k = loadPickup(pickupId);
  requireCoordinator(actor, k.chapter_id);
  const db = getDb();
  db.transaction(() => {
    const r = db.prepare("DELETE FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id = ?").run(pickupId, volunteerId);
    if (!r.changes) throw notFound("That volunteer is not assigned to this pickup.");
    reopenIfShort(k);
  })();
  logAudit(actor.id, "volunteer_unassigned", { chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId, detail: { volunteerId } });
}

/** A scheduled pickup that falls below two volunteers goes back to "pledged": it must not run with one person. */
function reopenIfShort(k: Ctx) {
  const cur = loadPickup(k.id);
  if (cur.status === "scheduled" && assignedCount(k.id) < 2) applyTransition(cur.pledge_id, "pledged", "A volunteer was removed: fewer than two assigned");
}

export function confirmWindow(actor: Actor, pickupId: string, raw: unknown) {
  const k = loadPickup(pickupId);
  requireCoordinator(actor, k.chapter_id);
  const { windowId } = confirmWindowSchema.parse(raw);
  if (!OPEN.includes(k.status)) throw conflict("pickup_closed", "This pickup is closed.");
  const w = pickupWindows(pickupId).find((x) => x.id === windowId);
  if (!w) throw invalid("That is not one of the donor's windows.");
  if (new Date(w.endAt) <= nowDate()) throw invalid("That window has already passed.");
  let scheduled = false;
  getDb().transaction(() => {
    getDb().prepare("UPDATE pickup SET scheduled_window_id = ? WHERE id = ?").run(windowId, pickupId);
    scheduled = trySchedule(k);
  })();
  logAudit(actor.id, "pickup_window_confirmed", { chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId });
  if (scheduled) notifyPickupScheduled(k.pledge_id);
  return { scheduled };
}

/** A volunteer takes an open slot: a pickup with a confirmed window that still needs volunteers. */
export function signUpForSlot(actor: Actor, pickupId: string) {
  const k = loadPickup(pickupId);
  if (!isVolunteerOf(actor, k.chapter_id)) throw notFound("Pickup not found");
  if (!k.scheduled_window_id) throw conflict("no_window", "This pickup has no confirmed window yet.");
  if (assignedCount(pickupId) >= 2) throw conflict("slot_full", "This pickup already has two volunteers.");
  let scheduled = false;
  getDb().transaction(() => {
    addAssignment(k, actor.id, actor.id);
    scheduled = trySchedule(k);
  })();
  logAudit(actor.id, "volunteer_signed_up", { chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId });
  if (scheduled) notifyPickupScheduled(k.pledge_id);
  return { scheduled };
}

/** Called when a volunteer loses their chapter role or deletes their account: open assignments are released. */
export function releaseOpenAssignments(userId: string, chapterId: string | null) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.pickup_id AS pickupId FROM pickup_assignment a JOIN pickup k ON k.id = a.pickup_id JOIN pledge p ON p.id = k.pledge_id
        WHERE a.volunteer_id = ? AND p.status IN ('pledged','scheduled') ${chapterId ? "AND k.chapter_id = ?" : ""}`,
    )
    .all(...(chapterId ? [userId, chapterId] : [userId])) as { pickupId: string }[];
  for (const r of rows) {
    db.prepare("DELETE FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id = ?").run(r.pickupId, userId);
    reopenIfShort(loadPickup(r.pickupId));
  }
}

// ---- check-in and check-out -----------------------------------------------------------------------------------------

function myAssignment(pickupId: string, userId: string) {
  const a = getDb().prepare("SELECT id, arrived_at AS arrivedAt, outcome FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id = ?").get(pickupId, userId) as { id: string; arrivedAt: string | null; outcome: string | null } | undefined;
  if (!a) throw notFound("Pickup not found");
  return a;
}

/** "Arrived": needs two assigned volunteers, a scheduled pickup, and no earlier than an hour before the window. */
export function arrive(actor: Actor, pickupId: string, at: Date = nowDate()) {
  const k = loadPickup(pickupId);
  const a = myAssignment(pickupId, actor.id);
  if (k.status !== "scheduled") throw conflict("pickup_not_open", "This pickup is not scheduled.");
  if (assignedCount(pickupId) < 2) throw conflict("two_volunteers_required", "Pickups are done in pairs. Wait until a second volunteer is assigned.");
  const w = referenceWindow(k)!;
  if (at < hoursFrom(w.start, -1)) throw conflict("too_early", "You can check in from one hour before the window.");
  if (a.arrivedAt) return { arrivedAt: a.arrivedAt };
  const t = at.toISOString();
  getDb().prepare("UPDATE pickup_assignment SET arrived_at = ? WHERE id = ?").run(t, a.id);
  logAudit(actor.id, "pickup_arrived", { chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId });
  return { arrivedAt: t };
}

/**
 * "Done (items collected)" or "Couldn't complete" with a reason.
 * - Collected: once every assigned volunteer has checked out as collected, the pledge becomes collected.
 * - Nobody there: no-show. Safety concern: cancelled and a priority report goes to coordinators.
 *   Other: cancelled with the note. "I can no longer make it": only this volunteer is removed.
 */
export function completePickup(actor: Actor, pickupId: string, raw: unknown, at: Date = nowDate()) {
  const input = completeSchema.parse(raw);
  const k = loadPickup(pickupId);
  const a = myAssignment(pickupId, actor.id);
  if (k.status !== "scheduled") throw conflict("pickup_not_open", "This pickup is no longer open.");
  const db = getDb();
  const t = at.toISOString();
  let closedAs: PledgeStatus | null = null;

  if (input.outcome === "collected") {
    if (!a.arrivedAt) throw conflict("not_arrived", "Tap “Arrived” first.");
    if (a.outcome) throw conflict("already_recorded", "You already checked out of this pickup.");
    db.transaction(() => {
      db.prepare("UPDATE pickup_assignment SET outcome = 'collected', completed_at = ? WHERE id = ?").run(t, a.id);
      const pending = (db.prepare("SELECT COUNT(*) AS n FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id IS NOT NULL AND (outcome IS NULL OR outcome <> 'collected')").get(pickupId) as { n: number }).n;
      if (pending === 0 && assignedCount(pickupId) >= 2) {
        applyTransition(k.pledge_id, "collected", "Collected by two volunteers");
        closedAs = "collected";
      }
    })();
  } else {
    const reason = input.reason;
    if (!reason) throw invalid("Choose a reason.");
    if ((reason === "other" || reason === "safety_concern") && input.note.length < 5) throw invalid("Add a few words of explanation.");
    db.transaction(() => {
      if (reason === "volunteer_unavailable") {
        db.prepare("DELETE FROM pickup_assignment WHERE id = ?").run(a.id);
        reopenIfShort(k);
        return;
      }
      db.prepare("UPDATE pickup_assignment SET outcome = 'could_not_complete', outcome_reason = ?, outcome_note = ?, completed_at = ? WHERE id = ?").run(reason, input.note || null, t, a.id);
      if (reason === "nobody_home") {
        applyTransition(k.pledge_id, "no_show", "Nobody was there at the pickup");
        closedAs = "no_show";
      } else {
        applyTransition(k.pledge_id, "cancelled", reason === "safety_concern" ? "A volunteer reported a safety concern" : input.note);
        closedAs = "cancelled";
        if (reason === "safety_concern") insertConcern({ chapterId: k.chapter_id, pledgeId: k.pledge_id, reporterId: actor.id, reporterRole: "volunteer", category: "safety", details: input.note });
      }
    })();
  }
  logAudit(actor.id, input.outcome === "collected" ? "pickup_checked_out" : "pickup_not_completed", {
    chapterId: k.chapter_id, subjectType: "pickup", subjectId: pickupId, detail: { reason: input.reason ?? null, closedAs },
  });
  if (closedAs === "collected") notifyCollected(k.pledge_id);
  return { closedAs };
}

// ---- purge ----------------------------------------------------------------------------------------------------------

/**
 * Erases address, notes and phone for pickups whose pledge was collected, cancelled or a no-show more than
 * PICKUP_PURGE_DAYS (default 7) ago. Run daily: `npm run admin:purge-pickups`. Windows and the audit trail stay.
 */
export function purgePickups(at: Date = nowDate(), days: number = config.pickupPurgeDays): number {
  const cutoff = hoursFrom(at, -24 * days).toISOString();
  const r = getDb()
    .prepare(
      `UPDATE pickup SET address_enc = NULL, notes_enc = NULL, phone_enc = NULL, purged_at = ?
        WHERE purged_at IS NULL AND (address_enc IS NOT NULL OR notes_enc IS NOT NULL OR phone_enc IS NOT NULL)
          AND pledge_id IN (SELECT id FROM pledge WHERE closed_at IS NOT NULL AND closed_at <= ?)`,
    )
    .run(at.toISOString(), cutoff);
  if (r.changes) logAudit(null, "pickups_purged", { detail: { count: r.changes, days } });
  return r.changes;
}

/** Erases one pickup's private details immediately (used when a donor deletes their account). */
export function purgePickupNow(pledgeId: string) {
  getDb().prepare("UPDATE pickup SET address_enc = NULL, notes_enc = NULL, phone_enc = NULL, purged_at = COALESCE(purged_at, ?) WHERE pledge_id = ?").run(now(), pledgeId);
}

// ---- overdue --------------------------------------------------------------------------------------------------------

/** Scheduled pickups still not closed `PICKUP_OVERDUE_HOURS` (default 2) after their window ended. */
function overdueRows(chapterId: string | null, at: Date): { pickupId: string; chapterId: string; notified: string | null }[] {
  const cutoff = hoursFrom(at, -config.pickupOverdueHours).toISOString();
  return getDb()
    .prepare(
      `SELECT k.id AS pickupId, k.chapter_id AS chapterId, k.overdue_notified_at AS notified
         FROM pickup k JOIN pledge p ON p.id = k.pledge_id JOIN pickup_window w ON w.id = k.scheduled_window_id
        WHERE p.status = 'scheduled' AND w.end_at <= ? ${chapterId ? "AND k.chapter_id = ?" : ""}`,
    )
    .all(...(chapterId ? [cutoff, chapterId] : [cutoff])) as { pickupId: string; chapterId: string; notified: string | null }[];
}

/** Emails each chapter's coordinators once per overdue pickup. Run every 15 minutes: `npm run admin:notify-overdue`. */
export function notifyOverduePickups(at: Date = nowDate()): number {
  let n = 0;
  for (const r of overdueRows(null, at)) {
    if (r.notified) continue;
    getDb().prepare("UPDATE pickup SET overdue_notified_at = ? WHERE id = ?").run(at.toISOString(), r.pickupId);
    notifyCoordinatorsOverdue(r.pickupId);
    logAudit(null, "pickup_overdue", { chapterId: r.chapterId, subjectType: "pickup", subjectId: r.pickupId });
    n++;
  }
  return n;
}

// ---- coordinator pickup board ---------------------------------------------------------------------------------------

export type PickupCard = {
  pickupId: string; pledgeId: string; status: PledgeStatus; items: string; donorName: string | null;
  windows: WindowView[]; confirmedWindowId: string | null; volunteers: { id: string; name: string; arrivedAt: string | null; outcome: string | null }[];
  overdue: boolean; visibleFrom: string | null;
};
export type PickupBoard = { unassigned: PickupCard[]; scheduled: PickupCard[]; today: PickupCard[]; overdue: PickupCard[] };

/** Unassigned / scheduled / today / overdue. Cards describe the pickup but never include the address. */
export function pickupBoard(actor: Actor, chapterId: string, at: Date = nowDate()): PickupBoard {
  requireCoordinator(actor, chapterId);
  const db = getDb();
  const tz = getChapter(chapterId).timezone;
  const overdueIds = new Set(overdueRows(chapterId, at).map((r) => r.pickupId));
  const rows = db
    .prepare(
      `SELECT k.id AS pickupId, k.pledge_id AS pledgeId, k.scheduled_window_id AS confirmedWindowId, p.status, u.name AS donorName
         FROM pickup k JOIN pledge p ON p.id = k.pledge_id LEFT JOIN "user" u ON u.id = p.donor_id
        WHERE k.chapter_id = ? AND p.status IN ('pledged','scheduled') ORDER BY k.created_at`,
    )
    .all(chapterId) as { pickupId: string; pledgeId: string; confirmedWindowId: string | null; status: PledgeStatus; donorName: string | null }[];
  const board: PickupBoard = { unassigned: [], scheduled: [], today: [], overdue: [] };
  const today = localDate(tz, at);
  for (const r of rows) {
    const windows = pickupWindows(r.pickupId);
    const ref = (r.confirmedWindowId && windows.find((w) => w.id === r.confirmedWindowId)) || windows[0];
    const items = db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM pledge_item WHERE pledge_id = ?").get(r.pledgeId) as { n: number };
    const card: PickupCard = {
      pickupId: r.pickupId, pledgeId: r.pledgeId, status: r.status, items: `${items.n} item${items.n === 1 ? "" : "s"}`, donorName: r.donorName,
      windows, confirmedWindowId: r.confirmedWindowId,
      volunteers: db
        .prepare("SELECT u.id, u.name, a.arrived_at AS arrivedAt, a.outcome FROM pickup_assignment a JOIN \"user\" u ON u.id = a.volunteer_id WHERE a.pickup_id = ? ORDER BY a.assigned_at, a.rowid")
        .all(r.pickupId) as PickupCard["volunteers"],
      overdue: overdueIds.has(r.pickupId),
      visibleFrom: ref ? hoursFrom(new Date(ref.startAt), -config.pickupVisibleHoursBefore).toISOString() : null,
    };
    if (card.overdue) board.overdue.push(card);
    else if (r.status === "pledged") board.unassigned.push(card);
    else if (ref && ref.date === today) board.today.push(card);
    else board.scheduled.push(card);
  }
  return board;
}

// ---- volunteer view ---------------------------------------------------------------------------------------------------

export type VolunteerPickup = {
  pickupId: string; pledgeId: string; chapterSlug: string; chapterName: string; timezone: string; status: PledgeStatus;
  window: WindowView | null; partners: string[]; units: number; visibleFrom: string | null; addressVisibleNow: boolean;
  arrivedAt: string | null; outcome: string | null; canArrive: boolean; canCheckOut: boolean;
};

/** My assignments: open ones, plus anything closed in the last week. The address is not included; fetch it with viewPickupDetails. */
export function myAssignments(actor: Actor, at: Date = nowDate()): VolunteerPickup[] {
  const db = getDb();
  const since = hoursFrom(at, -24 * 7).toISOString();
  const rows = db
    .prepare(
      `SELECT k.id AS pickupId, a.arrived_at AS arrivedAt, a.outcome FROM pickup_assignment a JOIN pickup k ON k.id = a.pickup_id JOIN pledge p ON p.id = k.pledge_id
        WHERE a.volunteer_id = ? AND (p.status IN ('pledged','scheduled') OR p.closed_at >= ?)`,
    )
    .all(actor.id, since) as { pickupId: string; arrivedAt: string | null; outcome: string | null }[];
  const out = rows.map((r) => {
    const k = loadPickup(r.pickupId);
    const ch = getChapter(k.chapter_id);
    const ws = pickupWindows(k.id);
    const w = ws.find((x) => x.id === k.scheduled_window_id) ?? null;
    const ref = referenceWindow(k);
    const access = addressAccess(actor, k.id, at);
    const n = assignedCount(k.id);
    return {
      pickupId: k.id, pledgeId: k.pledge_id, chapterSlug: ch.slug, chapterName: ch.name, timezone: ch.timezone, status: k.status,
      window: w, partners: (db.prepare("SELECT u.name FROM pickup_assignment a JOIN \"user\" u ON u.id = a.volunteer_id WHERE a.pickup_id = ? AND a.volunteer_id <> ?").all(k.id, actor.id) as { name: string }[]).map((x) => x.name),
      units: (db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM pledge_item WHERE pledge_id = ?").get(k.pledge_id) as { n: number }).n,
      visibleFrom: ref ? hoursFrom(ref.start, -config.pickupVisibleHoursBefore).toISOString() : null,
      addressVisibleNow: access.allowed,
      arrivedAt: r.arrivedAt, outcome: r.outcome,
      canArrive: k.status === "scheduled" && n >= 2 && !r.arrivedAt && !!ref && at >= hoursFrom(ref.start, -1),
      canCheckOut: k.status === "scheduled" && n >= 2 && !r.outcome,
    };
  });
  return out.sort((a, b) => (a.window?.startAt ?? "9").localeCompare(b.window?.startAt ?? "9"));
}

export type Slot = { pickupId: string; chapterSlug: string; chapterName: string; timezone: string; window: WindowView; volunteersNeeded: number; units: number };

/** Open slots in the chapters I volunteer for: confirmed window, fewer than two volunteers, not mine. No address, no donor. */
export function availableSlots(actor: Actor, at: Date = nowDate()): Slot[] {
  const db = getDb();
  const chapters = db.prepare("SELECT chapter_id AS id FROM chapter_member WHERE user_id = ?").all(actor.id) as { id: string }[];
  const out: Slot[] = [];
  for (const c of chapters) {
    const ch = getChapter(c.id);
    const rows = db
      .prepare(
        `SELECT k.id AS pickupId, k.pledge_id AS pledgeId FROM pickup k JOIN pledge p ON p.id = k.pledge_id
          WHERE k.chapter_id = ? AND k.scheduled_window_id IS NOT NULL AND p.status IN ('pledged','scheduled')
            AND (p.donor_id IS NULL OR p.donor_id <> ?)
            AND NOT EXISTS (SELECT 1 FROM pickup_assignment a WHERE a.pickup_id = k.id AND a.volunteer_id = ?)`,
      )
      .all(c.id, actor.id, actor.id) as { pickupId: string; pledgeId: string }[];
    for (const r of rows) {
      const n = assignedCount(r.pickupId);
      const k = loadPickup(r.pickupId);
      const w = pickupWindows(r.pickupId).find((x) => x.id === k.scheduled_window_id);
      if (!w || n >= 2 || new Date(w.endAt) <= at) continue;
      out.push({
        pickupId: r.pickupId, chapterSlug: ch.slug, chapterName: ch.name, timezone: ch.timezone, window: w, volunteersNeeded: 2 - n,
        units: (db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM pledge_item WHERE pledge_id = ?").get(r.pledgeId) as { n: number }).n,
      });
    }
  }
  return out.sort((a, b) => a.window.startAt.localeCompare(b.window.startAt));
}

