import { z } from "zod";
import { getDb, now, uid } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { rateLimit } from "../ratelimit";
import { encryptField } from "../crypto";
import { addDays, localDate, nowDate } from "../time";
import { coordinatorStatusSchema, pledgeSchema, receiveSchema, rescheduleDropoffSchema, reschedulePickupSchema } from "../validation";
import type { Actor, PledgeMethod, PledgeStatus } from "../types";
import { logAudit } from "./audit";
import { getChapter, getChapterBySlug, requireCoordinator } from "./access";
import { appendLedger } from "./inventory";
import { computeLines, refreshManualStatuses } from "./needs";
import { notifyCollected, notifyPickupScheduled, notifyPledgeConfirmed, notifyThankYou } from "./notifications";
import { syncTemplateNeeds } from "./templates";
import { getZone } from "./zones";
import { MAX_DAYS_AHEAD, validateWindows, type ValidWindow } from "./windows";

export const MAX_OPEN_PICKUPS = 3;
export const NEW_PLEDGES_PER_HOUR = 10;
const OPEN: PledgeStatus[] = ["pledged", "scheduled"];

// ---- the state machine ---------------------------------------------------------------------------------------------
//   pledged -> scheduled -> collected -> received (counted into stock)   |   cancelled   |   no_show
// A pickup is only ever collected by its two volunteers, so it cannot skip ahead. A drop-off needs no volunteers:
// whoever staffs the zone can mark it collected or count it straight into stock.
// scheduled -> pledged exists only for pickups, when a volunteer drops out (the two-person rule no longer holds).
type Flow = Record<PledgeStatus, PledgeStatus[]>;
const PICKUP_FLOW: Flow = {
  pledged: ["scheduled", "cancelled"],
  scheduled: ["pledged", "collected", "cancelled", "no_show"],
  collected: ["received"],
  received: [],
  cancelled: [],
  no_show: [],
};
const DROPOFF_FLOW: Flow = {
  pledged: ["scheduled", "collected", "received", "cancelled", "no_show"],
  scheduled: ["collected", "received", "cancelled", "no_show"],
  collected: ["received"],
  received: [],
  cancelled: [],
  no_show: [],
};
export const canTransition = (method: PledgeMethod, from: PledgeStatus, to: PledgeStatus) => (method === "pickup" ? PICKUP_FLOW : DROPOFF_FLOW)[from].includes(to);

type PledgeRow = {
  id: string; chapter_id: string; donor_id: string | null; method: PledgeMethod; zone_id: string | null; expected_date: string | null;
  status: PledgeStatus; closed_at: string | null; status_reason: string | null; created_at: string; updated_at: string;
};
export function loadPledge(id: string): PledgeRow {
  const r = getDb().prepare("SELECT * FROM pledge WHERE id = ?").get(id) as PledgeRow | undefined;
  if (!r) throw notFound("Pledge not found");
  return r;
}

/**
 * Moves a pledge along the state machine. Low level: callers check who may do it and run it inside a transaction.
 * Enforces the two-person rule: a pickup cannot become `scheduled` until a window is confirmed and at least two
 * volunteers are assigned.
 */
export function applyTransition(pledgeId: string, to: PledgeStatus, reason = ""): PledgeRow {
  const db = getDb();
  const p = loadPledge(pledgeId);
  if (!canTransition(p.method, p.status, to)) {
    throw conflict("invalid_transition", `A ${p.method === "pickup" ? "pickup" : "drop-off"} pledge that is “${p.status}” cannot become “${to}”.`);
  }
  if (p.method === "pickup" && to === "scheduled") {
    const pk = db.prepare("SELECT id, scheduled_window_id AS w FROM pickup WHERE pledge_id = ?").get(pledgeId) as { id: string; w: string | null } | undefined;
    const n = pk ? (db.prepare("SELECT COUNT(*) AS n FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id IS NOT NULL").get(pk.id) as { n: number }).n : 0;
    if (n < 2) throw conflict("two_volunteers_required", "A pickup needs two assigned volunteers before it can be scheduled.");
    if (!pk?.w) throw conflict("window_required", "Confirm one of the donor's pickup windows before scheduling.");
  }
  const closing = to === "collected" || to === "cancelled" || to === "no_show" || to === "received";
  db.prepare("UPDATE pledge SET status = ?, status_reason = ?, updated_at = ?, closed_at = COALESCE(closed_at, ?) WHERE id = ?").run(to, reason || null, now(), closing ? now() : null, pledgeId);
  return { ...p, status: to };
}

// ---- creating a pledge -------------------------------------------------------------------------------------------

/**
 * A donor pledges items from open needs and chooses a pickup (private address, daytime windows) or a drop-off
 * zone (public location, expected date). Limits: at most 3 open pickup pledges, and 10 new pledges per hour.
 */
export function createPledge(actor: Actor, raw: unknown, at: Date = nowDate()): { id: string } {
  rateLimit(`pledge:${actor.id}`, NEW_PLEDGES_PER_HOUR, 3600_000);
  const input = pledgeSchema.parse(raw);
  const chapter = getChapterBySlug(input.chapter);
  if (!chapter.active) throw conflict("chapter_inactive", "This chapter is not taking pledges right now.");
  const needIds = input.items.map((i) => i.needId);
  if (new Set(needIds).size !== needIds.length) throw invalid("Each item can appear only once in a pledge.");

  let windows: ValidWindow[] = [];
  if (input.method === "pickup") windows = validateWindows(input.windows, chapter.timezone, at);
  else {
    const z = getZone(input.zoneId);
    if (z.chapterId !== chapter.id || !z.active) throw invalid("Choose one of this chapter's active drop-off zones.");
    const today = localDate(chapter.timezone, at);
    if (input.expectedDate < today || input.expectedDate > addDays(today, MAX_DAYS_AHEAD)) throw invalid("Choose a drop-off date from today to 60 days ahead.");
  }

  const db = getDb();
  const pledgeId = uid();
  db.transaction(() => {
    if (input.method === "pickup") {
      const open = (db.prepare("SELECT COUNT(*) AS n FROM pledge WHERE donor_id = ? AND method = 'pickup' AND status IN ('pledged','scheduled')").get(actor.id) as { n: number }).n;
      if (open >= MAX_OPEN_PICKUPS) {
        throw conflict("pickup_limit", `You already have ${MAX_OPEN_PICKUPS} open pickup pledges. Finish or cancel one before adding another, or choose a drop-off.`);
      }
    }
    const lines = new Map(computeLines(chapter.id).map((l) => [l.needId, l]));
    for (const it of input.items) {
      const line = lines.get(it.needId);
      if (!line || line.status !== "open") throw invalid("One of those items is no longer needed. Refresh the page and try again.");
      if (it.quantity > line.remaining) {
        throw conflict("need_exceeded", line.remaining > 0 ? `We only need ${line.remaining} more of “${line.itemName}” right now.` : `“${line.itemName}” is fully pledged right now.`);
      }
    }
    db.prepare("INSERT INTO pledge (id, chapter_id, donor_id, method, zone_id, expected_date, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'pledged',?,?)").run(
      pledgeId, chapter.id, actor.id, input.method, input.method === "dropoff" ? input.zoneId : null, input.method === "dropoff" ? input.expectedDate : null, now(), now(),
    );
    for (const it of input.items) {
      const line = lines.get(it.needId)!;
      db.prepare("INSERT INTO pledge_item (id, pledge_id, need_id, item_id, quantity) VALUES (?,?,?,?,?)").run(uid(), pledgeId, it.needId, line.itemId, it.quantity);
    }
    if (input.method === "pickup") {
      const pickupId = uid();
      db.prepare("INSERT INTO pickup (id, pledge_id, chapter_id, address_enc, notes_enc, phone_enc, created_at) VALUES (?,?,?,?,?,?,?)").run(
        pickupId, pledgeId, chapter.id,
        encryptField(input.address, pickupId),
        input.notes ? encryptField(input.notes, pickupId) : null,
        input.phone ? encryptField(input.phone, pickupId) : null,
        now(),
      );
      insertWindows(pickupId, windows);
    }
  })();
  logAudit(actor.id, "pledge_created", { chapterId: chapter.id, subjectType: "pledge", subjectId: pledgeId, detail: { method: input.method } });
  notifyPledgeConfirmed(pledgeId);
  return { id: pledgeId };
}

export function insertWindows(pickupId: string, windows: ValidWindow[]) {
  const db = getDb();
  for (const w of windows) {
    db.prepare("INSERT INTO pickup_window (id, pickup_id, date, start_time, end_time, start_at, end_at) VALUES (?,?,?,?,?,?,?)").run(uid(), pickupId, w.date, w.start, w.end, w.startAt, w.endAt);
  }
}

// ---- reading pledges ---------------------------------------------------------------------------------------------

export type WindowView = { id: string; date: string; start: string; end: string; startAt: string; endAt: string };
export type PledgeLine = { lineId: string; itemId: string; itemName: string; unit: string; quantity: number; receivedQuantity: number | null };
export type PledgeView = {
  id: string; chapterSlug: string; chapterName: string; timezone: string; method: PledgeMethod; status: PledgeStatus; createdAt: string;
  expectedDate: string | null; zone: { id: string; name: string; description: string; hours: string } | null;
  items: PledgeLine[];
  /** Pickup metadata only. The address, notes and phone are never part of this object (see pickups.viewPickupDetails). */
  pickup: null | { id: string; windows: WindowView[]; scheduledWindowId: string | null; volunteerCount: number; detailsPurged: boolean };
};

export function pledgeLines(pledgeId: string): PledgeLine[] {
  return getDb()
    .prepare(
      `SELECT pi.id AS lineId, pi.item_id AS itemId, i.name AS itemName, i.unit, pi.quantity, pi.received_quantity AS receivedQuantity
         FROM pledge_item pi JOIN item i ON i.id = pi.item_id WHERE pi.pledge_id = ? ORDER BY pi.rowid`,
    )
    .all(pledgeId) as PledgeLine[];
}
export function pickupWindows(pickupId: string): WindowView[] {
  return getDb().prepare("SELECT id, date, start_time AS start, end_time AS end, start_at AS startAt, end_at AS endAt FROM pickup_window WHERE pickup_id = ? ORDER BY start_at").all(pickupId) as WindowView[];
}

function toView(p: PledgeRow): PledgeView {
  const db = getDb();
  const ch = getChapter(p.chapter_id);
  const zone = p.zone_id ? getZone(p.zone_id) : null;
  const pk = db.prepare("SELECT id, scheduled_window_id AS w, purged_at AS purged FROM pickup WHERE pledge_id = ?").get(p.id) as { id: string; w: string | null; purged: string | null } | undefined;
  return {
    id: p.id, chapterSlug: ch.slug, chapterName: ch.name, timezone: ch.timezone, method: p.method, status: p.status, createdAt: p.created_at,
    expectedDate: p.expected_date, zone: zone ? { id: zone.id, name: zone.name, description: zone.description, hours: zone.hours } : null,
    items: pledgeLines(p.id),
    pickup: pk
      ? {
          id: pk.id, windows: pickupWindows(pk.id), scheduledWindowId: pk.w, detailsPurged: !!pk.purged,
          volunteerCount: (db.prepare("SELECT COUNT(*) AS n FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id IS NOT NULL").get(pk.id) as { n: number }).n,
        }
      : null,
  };
}

export function listMyPledges(actor: Actor): PledgeView[] {
  const rows = getDb().prepare("SELECT * FROM pledge WHERE donor_id = ? ORDER BY created_at DESC, rowid DESC").all(actor.id) as PledgeRow[];
  return rows.map(toView);
}
export function getMyPledge(actor: Actor, pledgeId: string): PledgeView {
  const p = loadPledge(pledgeId);
  if (p.donor_id !== actor.id) throw notFound("Pledge not found");
  return toView(p);
}

// ---- donor actions -------------------------------------------------------------------------------------------------

export function cancelPledge(actor: Actor, pledgeId: string, reason = "Cancelled by the donor") {
  const p = loadPledge(pledgeId);
  if (p.donor_id !== actor.id) throw notFound("Pledge not found");
  if (!OPEN.includes(p.status)) throw conflict("not_cancellable", "This pledge can no longer be cancelled.");
  getDb().transaction(() => applyTransition(pledgeId, "cancelled", reason))();
  logAudit(actor.id, "pledge_cancelled", { chapterId: p.chapter_id, subjectType: "pledge", subjectId: pledgeId, detail: { by: "donor" } });
}

/** Change pickup windows (a scheduled pickup goes back to "pledged" for a coordinator to re-confirm) or the drop-off zone and date. */
export function reschedulePledge(actor: Actor, pledgeId: string, raw: unknown, at: Date = nowDate()) {
  const p = loadPledge(pledgeId);
  if (p.donor_id !== actor.id) throw notFound("Pledge not found");
  if (!OPEN.includes(p.status)) throw conflict("not_reschedulable", "This pledge can no longer be rescheduled.");
  const ch = getChapter(p.chapter_id);
  const db = getDb();
  if (p.method === "pickup") {
    const input = reschedulePickupSchema.parse(raw);
    const windows = validateWindows(input.windows, ch.timezone, at);
    const pk = db.prepare("SELECT id FROM pickup WHERE pledge_id = ?").get(pledgeId) as { id: string };
    db.transaction(() => {
      db.prepare("DELETE FROM pickup_window WHERE pickup_id = ?").run(pk.id);
      insertWindows(pk.id, windows);
      db.prepare("UPDATE pickup SET scheduled_window_id = NULL WHERE id = ?").run(pk.id);
      if (p.status === "scheduled") applyTransition(pledgeId, "pledged", "Donor changed the pickup windows");
      db.prepare("UPDATE pledge SET updated_at = ? WHERE id = ?").run(now(), pledgeId);
    })();
  } else {
    const input = rescheduleDropoffSchema.parse(raw);
    const z = getZone(input.zoneId);
    if (z.chapterId !== p.chapter_id || !z.active) throw invalid("Choose one of this chapter's active drop-off zones.");
    const today = localDate(ch.timezone, at);
    if (input.expectedDate < today || input.expectedDate > addDays(today, MAX_DAYS_AHEAD)) throw invalid("Choose a drop-off date from today to 60 days ahead.");
    db.prepare("UPDATE pledge SET zone_id = ?, expected_date = ?, updated_at = ? WHERE id = ?").run(input.zoneId, input.expectedDate, now(), pledgeId);
  }
  logAudit(actor.id, "pledge_rescheduled", { chapterId: p.chapter_id, subjectType: "pledge", subjectId: pledgeId });
}

// ---- coordinator actions -------------------------------------------------------------------------------------------

/**
 * Coordinator status changes: cancel, mark a no-show, schedule a drop-off, or close a pickup as collected when
 * the volunteers could not (the reason is recorded). Pickups still obey the two-volunteer rule for `scheduled`.
 */
export function coordinatorTransition(actor: Actor, pledgeId: string, raw: unknown) {
  const p = loadPledge(pledgeId);
  requireCoordinator(actor, p.chapter_id);
  const input = coordinatorStatusSchema.parse(raw);
  if (p.method === "pickup" && input.status === "collected" && input.reason.length < 5) throw invalid("Say why you are closing this pickup as collected (a few words).");
  getDb().transaction(() => applyTransition(pledgeId, input.status, input.reason))();
  logAudit(actor.id, "pledge_status_set", { chapterId: p.chapter_id, subjectType: "pledge", subjectId: pledgeId, detail: { from: p.status, to: input.status } });
  if (input.status === "collected") notifyCollected(pledgeId);
  if (input.status === "scheduled" && p.method === "pickup") notifyPickupScheduled(pledgeId);
}

export type DropoffRow = { pledgeId: string; zoneId: string; zoneName: string; expectedDate: string; status: PledgeStatus; donorName: string | null; items: string };

/** Incoming drop-offs by zone and date (pledges not yet counted). The donor shows only as a pseudonymous display name. */
export function listIncomingDropoffs(actor: Actor, chapterId: string): DropoffRow[] {
  requireCoordinator(actor, chapterId);
  const rows = getDb()
    .prepare(
      `SELECT p.id AS pledgeId, z.id AS zoneId, z.name AS zoneName, p.expected_date AS expectedDate, p.status, u.name AS donorName
         FROM pledge p JOIN zone z ON z.id = p.zone_id LEFT JOIN "user" u ON u.id = p.donor_id
        WHERE p.chapter_id = ? AND p.method = 'dropoff' AND p.status IN ('pledged','scheduled','collected')
        ORDER BY p.expected_date, z.name, p.created_at`,
    )
    .all(chapterId) as Omit<DropoffRow, "items">[];
  return rows.map((r) => ({ ...r, items: pledgeLines(r.pledgeId).map((l) => `${l.quantity} × ${l.itemName}`).join(", ") }));
}

export type AwaitingReceipt = { pledgeId: string; method: PledgeMethod; status: PledgeStatus; donorName: string | null; expectedDate: string | null; zoneName: string | null; lines: PledgeLine[] };

/** Pledges ready to be counted into stock: collected pickups, and drop-offs that have arrived. */
export function listAwaitingReceipt(actor: Actor, chapterId: string): AwaitingReceipt[] {
  requireCoordinator(actor, chapterId);
  const rows = getDb()
    .prepare(
      `SELECT p.id AS pledgeId, p.method, p.status, u.name AS donorName, p.expected_date AS expectedDate, z.name AS zoneName
         FROM pledge p LEFT JOIN "user" u ON u.id = p.donor_id LEFT JOIN zone z ON z.id = p.zone_id
        WHERE p.chapter_id = ? AND (p.status = 'collected' OR (p.method = 'dropoff' AND p.status IN ('pledged','scheduled')))
        ORDER BY p.created_at`,
    )
    .all(chapterId) as Omit<AwaitingReceipt, "lines">[];
  return rows.map((r) => ({ ...r, lines: pledgeLines(r.pledgeId) }));
}

/**
 * Counts a pledge into inventory: a quick count per pledged line (which may differ from what was pledged, down
 * to zero) plus any extra items that nobody pledged. One transaction: ledger rows, pledge status and need statuses.
 */
export function receivePledge(actor: Actor, pledgeId: string, raw: z.input<typeof receiveSchema>) {
  const p = loadPledge(pledgeId);
  requireCoordinator(actor, p.chapter_id);
  const input = receiveSchema.parse(raw);
  const db = getDb();
  const lines = pledgeLines(pledgeId);
  const given = new Map(input.lines.map((l) => [l.lineId, l.quantity]));
  if (given.size !== input.lines.length || lines.some((l) => !given.has(l.lineId)) || input.lines.some((l) => !lines.find((x) => x.lineId === l.lineId))) {
    throw invalid("Enter a count for every pledged item (0 if none arrived).");
  }
  const total = input.lines.reduce((n, l) => n + l.quantity, 0) + input.extras.reduce((n, e) => n + e.quantity, 0);
  if (total === 0) throw invalid("Nothing was received. Mark the pledge as a no-show instead.");
  db.transaction(() => {
    applyTransition(pledgeId, "received", input.note);
    for (const l of lines) {
      const q = given.get(l.lineId)!;
      db.prepare("UPDATE pledge_item SET received_quantity = ? WHERE id = ?").run(q, l.lineId);
      if (q > 0) appendLedger({ chapterId: p.chapter_id, itemId: l.itemId, delta: q, kind: "received", pledgeId, note: input.note, actorId: actor.id });
    }
    for (const e of input.extras) {
      const item = db.prepare("SELECT id FROM item WHERE id = ? AND active = 1").get(e.itemId);
      if (!item) throw invalid("One of the extra items is not in the catalog.");
      db.prepare("INSERT INTO pledge_item (id, pledge_id, need_id, item_id, quantity, received_quantity) VALUES (?,?,NULL,?,0,?)").run(uid(), pledgeId, e.itemId, e.quantity);
      appendLedger({ chapterId: p.chapter_id, itemId: e.itemId, delta: e.quantity, kind: "received", pledgeId, note: input.note || "Not pledged", actorId: actor.id });
    }
    refreshManualStatuses(p.chapter_id);
    syncTemplateNeeds(p.chapter_id);
  })();
  logAudit(actor.id, "pledge_received", { chapterId: p.chapter_id, subjectType: "pledge", subjectId: pledgeId, detail: { units: total } });
  notifyThankYou(pledgeId, total);
  return { received: total };
}

