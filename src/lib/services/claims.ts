import { getDb, now, uid } from "../db";
import { config } from "../config";
import { conflict, invalid, notFound } from "../errors";
import { rateLimit } from "../ratelimit";
import { encryptField } from "../crypto";
import { addDays, hoursFrom, localDate, nowDate } from "../time";
import { claimSchema, coordinatorStatusSchema, receiveSchema, rescheduleDropoffSchema, reschedulePickupSchema } from "../validation";
import type { Actor, ClaimMethod, ClaimStatus, RequestStatus, RequestType } from "../types";
import { logAudit } from "./audit";
import { getChapter, requireCoordinator } from "./access";
import { getItem, itemLabel, normalizeSize } from "./items";
import { notifyClaimConfirmed, notifyClaimReleased, notifyCollected, notifyPickupScheduled } from "./notifications";
import { coverage, loadRequest, refreshRequest, type RequestRow } from "./request-core";
import { syncRestock } from "./restock";
import { appendLedger } from "./stock";
import { getZone } from "./zones";
import { MAX_DAYS_AHEAD, validateWindows, type ValidWindow } from "./windows";

export const MAX_OPEN_PICKUPS = 3;
export const NEW_CLAIMS_PER_HOUR = 10;
const OPEN: ClaimStatus[] = ["claimed", "scheduled"];

// ---- the state machine ---------------------------------------------------------------------------------------------------
//   claimed -> scheduled -> collected -> received (counted in)   |   cancelled   |   no_show
// A pickup is only collected by its two volunteers, so it cannot skip ahead. A drop-off is `scheduled` as soon as the
// neighbour picks a zone and date; whoever staffs the zone can mark it collected or count it straight in.
// scheduled -> claimed exists only for pickups that lose a volunteer (the two-person rule no longer holds).
type Flow = Record<ClaimStatus, ClaimStatus[]>;
const PICKUP_FLOW: Flow = {
  claimed: ["scheduled", "cancelled"],
  scheduled: ["claimed", "collected", "cancelled", "no_show"],
  collected: ["received"],
  received: [], cancelled: [], no_show: [],
};
const DROPOFF_FLOW: Flow = {
  claimed: ["scheduled", "collected", "received", "cancelled", "no_show"],
  scheduled: ["collected", "received", "cancelled", "no_show"],
  collected: ["received"],
  received: [], cancelled: [], no_show: [],
};
export const canTransition = (method: ClaimMethod, from: ClaimStatus, to: ClaimStatus) => (method === "pickup" ? PICKUP_FLOW : DROPOFF_FLOW)[from].includes(to);

export type ClaimRow = {
  id: string; request_id: string; chapter_id: string; neighbour_id: string | null; quantity: number; method: ClaimMethod; zone_id: string | null;
  expected_date: string | null; status: ClaimStatus; release_at: string | null; received_quantity: number | null; closed_at: string | null;
  status_reason: string | null; created_at: string; updated_at: string;
};
export function loadClaim(id: string): ClaimRow {
  const r = getDb().prepare("SELECT * FROM claim WHERE id = ?").get(id) as ClaimRow | undefined;
  if (!r) throw notFound("Claim not found");
  return r;
}

/**
 * Moves a claim along the state machine and refreshes its request. Low level: callers check who may do it and run it
 * in a transaction. Enforces the two-person rule: a pickup cannot become `scheduled` until a window is confirmed and
 * at least two volunteers are assigned.
 */
export function applyTransition(claimId: string, to: ClaimStatus, reason = ""): ClaimRow {
  const db = getDb();
  const c = loadClaim(claimId);
  if (!canTransition(c.method, c.status, to)) {
    throw conflict("invalid_transition", `A ${c.method === "pickup" ? "pickup" : "drop-off"} claim that is “${c.status}” cannot become “${to}”.`);
  }
  if (c.method === "pickup" && to === "scheduled") {
    const pk = db.prepare("SELECT id, scheduled_window_id AS w FROM pickup WHERE claim_id = ?").get(claimId) as { id: string; w: string | null } | undefined;
    const n = pk ? (db.prepare("SELECT COUNT(*) AS n FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id IS NOT NULL").get(pk.id) as { n: number }).n : 0;
    if (n < 2) throw conflict("two_volunteers_required", "A pickup needs two assigned volunteers before it can be scheduled.");
    if (!pk?.w) throw conflict("window_required", "Confirm one of the neighbour's pickup windows before scheduling.");
  }
  const closing = to === "collected" || to === "cancelled" || to === "no_show" || to === "received";
  const release = to === "claimed" ? hoursFrom(nowDate(), config.claimReleaseHours).toISOString() : null;
  db.prepare("UPDATE claim SET status = ?, status_reason = ?, updated_at = ?, closed_at = COALESCE(closed_at, ?), release_at = ? WHERE id = ?").run(to, reason || null, now(), closing ? now() : null, release, claimId);
  refreshRequest(c.request_id);
  return { ...c, status: to };
}

// ---- creating a claim ------------------------------------------------------------------------------------------------------------

/**
 * A neighbour claims a request, or part of its quantity, and chooses a pickup (private address, daytime windows) or a
 * drop-off zone and date. Limits: at most 3 open pickup claims, and 10 new claims per hour. A pickup claim that is not
 * scheduled within CLAIM_RELEASE_HOURS (48) is released and the request reopens.
 */
export function createClaim(actor: Actor, raw: unknown, at: Date = nowDate()): { id: string } {
  rateLimit(`claim:${actor.id}`, NEW_CLAIMS_PER_HOUR, 3600_000);
  const input = claimSchema.parse(raw);
  const r0 = loadRequest(input.requestId);
  const chapter = getChapter(r0.chapter_id);
  if (!chapter.active) throw conflict("chapter_inactive", "This chapter is not taking claims right now.");

  let windows: ValidWindow[] = [];
  if (input.method === "pickup") {
    windows = validateWindows(input.windows, chapter.timezone, at);
    if (windows.some((w) => w.date > r0.needed_by)) throw invalid(`This request is needed by ${r0.needed_by}. Choose pickup windows on or before that date, or a drop-off.`);
  } else {
    const z = getZone(input.zoneId);
    if (z.chapterId !== chapter.id || !z.active) throw invalid("Choose one of this chapter's active drop-off zones.");
    const today = localDate(chapter.timezone, at);
    const last = r0.needed_by < addDays(today, MAX_DAYS_AHEAD) ? r0.needed_by : addDays(today, MAX_DAYS_AHEAD);
    if (input.expectedDate < today || input.expectedDate > last) throw invalid(`Choose a drop-off date from today to ${last} (the request is needed by ${r0.needed_by}).`);
  }

  const db = getDb();
  const claimId = uid();
  db.transaction(() => {
    const r = loadRequest(input.requestId);
    if (r.type === "kit") throw conflict("kit_request", "Kit requests are filled by the student team from stock. You can help by claiming a restock request instead.");
    if (r.status !== "open" && r.status !== "claimed") throw conflict("request_closed", "This request is no longer open. Refresh the board.");
    if (r.created_by === actor.id) throw invalid("You cannot claim a request you posted yourself.");
    if (input.method === "pickup") {
      const open = (db.prepare("SELECT COUNT(*) AS n FROM claim WHERE neighbour_id = ? AND method = 'pickup' AND status IN ('claimed','scheduled')").get(actor.id) as { n: number }).n;
      if (open >= MAX_OPEN_PICKUPS) throw conflict("pickup_limit", `You already have ${MAX_OPEN_PICKUPS} open pickup claims. Finish or cancel one before adding another, or choose a drop-off.`);
    }
    const { remaining } = coverage(r);
    if (input.quantity > remaining) {
      throw conflict("quantity_exceeded", remaining > 0 ? `Only ${remaining} more ${remaining === 1 ? "is" : "are"} still needed for this request.` : "This request is fully claimed. Refresh the board.");
    }
    db.prepare("INSERT INTO claim (id, request_id, chapter_id, neighbour_id, quantity, method, zone_id, expected_date, status, release_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      claimId, r.id, chapter.id, actor.id, input.quantity, input.method, input.method === "dropoff" ? input.zoneId : null, input.method === "dropoff" ? input.expectedDate : null,
      input.method === "dropoff" ? "scheduled" : "claimed", input.method === "pickup" ? hoursFrom(at, config.claimReleaseHours).toISOString() : null, now(), now(),
    );
    if (input.method === "pickup") {
      const pickupId = uid();
      db.prepare("INSERT INTO pickup (id, claim_id, chapter_id, address_enc, notes_enc, phone_enc, created_at) VALUES (?,?,?,?,?,?,?)").run(
        pickupId, claimId, chapter.id, encryptField(input.address, pickupId), input.notes ? encryptField(input.notes, pickupId) : null, input.phone ? encryptField(input.phone, pickupId) : null, now(),
      );
      insertWindows(pickupId, windows);
    }
    refreshRequest(r.id);
  })();
  logAudit(actor.id, "claim_created", { chapterId: chapter.id, subjectType: "claim", subjectId: claimId, detail: { method: input.method, requestId: input.requestId } });
  notifyClaimConfirmed(claimId);
  return { id: claimId };
}

export function insertWindows(pickupId: string, windows: ValidWindow[]) {
  const db = getDb();
  for (const w of windows) db.prepare("INSERT INTO pickup_window (id, pickup_id, date, start_time, end_time, start_at, end_at) VALUES (?,?,?,?,?,?,?)").run(uid(), pickupId, w.date, w.start, w.end, w.startAt, w.endAt);
}

// ---- reading claims ------------------------------------------------------------------------------------------------------------------

export type WindowView = { id: string; date: string; start: string; end: string; startAt: string; endAt: string };
export function pickupWindows(pickupId: string): WindowView[] {
  return getDb().prepare("SELECT id, date, start_time AS start, end_time AS end, start_at AS startAt, end_at AS endAt FROM pickup_window WHERE pickup_id = ? ORDER BY start_at").all(pickupId) as WindowView[];
}

export type ClaimView = {
  id: string; chapterSlug: string; chapterName: string; timezone: string; method: ClaimMethod; status: ClaimStatus; createdAt: string; quantity: number;
  receivedQuantity: number | null; expectedDate: string | null; zone: { id: string; name: string; description: string; hours: string } | null; releaseAt: string | null;
  request: { id: string; type: RequestType; label: string; partnerName: string | null; siteName: string | null; neededBy: string; status: RequestStatus };
  /** The feedback loop: set once the item reached the partner. */
  delivered: { partnerName: string; at: string; confirmed: boolean } | null;
  /** Units of this claim that went into fast stock instead of this request (it was already filled, or it is a restock request). */
  wentToStock: number;
  pickup: null | { id: string; windows: WindowView[]; scheduledWindowId: string | null; volunteerCount: number; detailsPurged: boolean };
};

type ReqInfo = { type: RequestType; item: string | null; kit: string | null; size: string; partner: string | null; site: string | null; neededBy: string; status: RequestStatus; deliveredAt: string | null; confirmedAt: string | null; partnerName: string | null };
export function requestInfo(requestId: string): ReqInfo & { label: string } {
  const r = getDb()
    .prepare(
      `SELECT q.type, i.name AS item, k.name AS kit, q.size, p.name AS partner, s.name AS site, q.needed_by AS neededBy, q.status, q.delivered_at AS deliveredAt, q.confirmed_at AS confirmedAt, p.name AS partnerName
         FROM request q LEFT JOIN item i ON i.id = q.item_id LEFT JOIN kit_template k ON k.id = q.kit_template_id LEFT JOIN partner p ON p.id = q.partner_id LEFT JOIN delivery_site s ON s.id = q.delivery_site_id WHERE q.id = ?`,
    )
    .get(requestId) as ReqInfo | undefined;
  if (!r) throw notFound("Request not found");
  return { ...r, label: itemLabel(r.item ?? r.kit ?? "Items", r.size) };
}

function toView(c: ClaimRow): ClaimView {
  const db = getDb();
  const ch = getChapter(c.chapter_id);
  const q = requestInfo(c.request_id);
  const zone = c.zone_id ? getZone(c.zone_id) : null;
  const pk = db.prepare("SELECT id, scheduled_window_id AS w, purged_at AS purged FROM pickup WHERE claim_id = ?").get(c.id) as { id: string; w: string | null; purged: string | null } | undefined;
  const toRequest = (db.prepare("SELECT COALESCE(-SUM(delta), 0) AS n FROM stock_ledger WHERE claim_id = ? AND kind = 'allocated_to_request'").get(c.id) as { n: number }).n;
  const got = c.status === "received" ? c.received_quantity ?? 0 : 0;
  return {
    id: c.id, chapterSlug: ch.slug, chapterName: ch.name, timezone: ch.timezone, method: c.method, status: c.status, createdAt: c.created_at, quantity: c.quantity,
    receivedQuantity: c.received_quantity, expectedDate: c.expected_date, releaseAt: c.status === "claimed" ? c.release_at : null,
    zone: zone ? { id: zone.id, name: zone.name, description: zone.description, hours: zone.hours } : null,
    request: { id: c.request_id, type: q.type, label: q.label, partnerName: q.partnerName, siteName: q.site, neededBy: q.neededBy, status: q.status },
    delivered: got > 0 && toRequest > 0 && (q.status === "delivered" || q.status === "confirmed") && q.deliveredAt && q.partnerName ? { partnerName: q.partnerName, at: q.deliveredAt, confirmed: q.status === "confirmed" } : null,
    wentToStock: Math.max(0, got - toRequest),
    pickup: pk
      ? {
          id: pk.id, windows: pickupWindows(pk.id), scheduledWindowId: pk.w, detailsPurged: !!pk.purged,
          volunteerCount: (db.prepare("SELECT COUNT(*) AS n FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id IS NOT NULL").get(pk.id) as { n: number }).n,
        }
      : null,
  };
}
export function listMyClaims(actor: Actor): ClaimView[] {
  return (getDb().prepare("SELECT * FROM claim WHERE neighbour_id = ? ORDER BY created_at DESC, rowid DESC").all(actor.id) as ClaimRow[]).map(toView);
}
export function getMyClaim(actor: Actor, claimId: string): ClaimView {
  const c = loadClaim(claimId);
  if (c.neighbour_id !== actor.id) throw notFound("Claim not found");
  return toView(c);
}

// ---- neighbour actions -----------------------------------------------------------------------------------------------------------------
export function cancelClaim(actor: Actor, claimId: string, reason = "Cancelled by the neighbour") {
  const c = loadClaim(claimId);
  if (c.neighbour_id !== actor.id) throw notFound("Claim not found");
  if (!OPEN.includes(c.status)) throw conflict("not_cancellable", "This claim can no longer be cancelled.");
  getDb().transaction(() => applyTransition(claimId, "cancelled", reason))();
  logAudit(actor.id, "claim_cancelled", { chapterId: c.chapter_id, subjectType: "claim", subjectId: claimId, detail: { by: "neighbour" } });
}

/** Change pickup windows (a scheduled pickup goes back to "claimed" to be re-confirmed) or the drop-off zone and date. */
export function rescheduleClaim(actor: Actor, claimId: string, raw: unknown, at: Date = nowDate()) {
  const c = loadClaim(claimId);
  if (c.neighbour_id !== actor.id) throw notFound("Claim not found");
  if (!OPEN.includes(c.status)) throw conflict("not_reschedulable", "This claim can no longer be rescheduled.");
  const ch = getChapter(c.chapter_id);
  const r = loadRequest(c.request_id);
  const db = getDb();
  if (c.method === "pickup") {
    const input = reschedulePickupSchema.parse(raw);
    const windows = validateWindows(input.windows, ch.timezone, at);
    if (windows.some((w) => w.date > r.needed_by)) throw invalid(`This request is needed by ${r.needed_by}. Choose windows on or before that date.`);
    const pk = db.prepare("SELECT id FROM pickup WHERE claim_id = ?").get(claimId) as { id: string };
    db.transaction(() => {
      db.prepare("DELETE FROM pickup_window WHERE pickup_id = ?").run(pk.id);
      insertWindows(pk.id, windows);
      db.prepare("UPDATE pickup SET scheduled_window_id = NULL WHERE id = ?").run(pk.id);
      if (c.status === "scheduled") applyTransition(claimId, "claimed", "Neighbour changed the pickup windows");
      db.prepare("UPDATE claim SET updated_at = ? WHERE id = ?").run(now(), claimId);
    })();
  } else {
    const input = rescheduleDropoffSchema.parse(raw);
    const z = getZone(input.zoneId);
    if (z.chapterId !== c.chapter_id || !z.active) throw invalid("Choose one of this chapter's active drop-off zones.");
    const today = localDate(ch.timezone, at);
    if (input.expectedDate < today || input.expectedDate > r.needed_by) throw invalid(`Choose a drop-off date from today to ${r.needed_by}.`);
    db.prepare("UPDATE claim SET zone_id = ?, expected_date = ?, updated_at = ? WHERE id = ?").run(input.zoneId, input.expectedDate, now(), claimId);
  }
  logAudit(actor.id, "claim_rescheduled", { chapterId: c.chapter_id, subjectType: "claim", subjectId: claimId });
}

// ---- automatic release ----------------------------------------------------------------------------------------------------------------
/**
 * Pickup claims still `claimed` (not scheduled with a window and two volunteers) after CLAIM_RELEASE_HOURS (48) are released:
 * the claim is cancelled, the request reopens for someone else, and the neighbour is told. Run from the sweep job.
 */
export function releaseStaleClaims(at: Date = nowDate()): number {
  const db = getDb();
  const rows = db.prepare("SELECT id, chapter_id AS chapterId FROM claim WHERE status = 'claimed' AND release_at IS NOT NULL AND release_at <= ?").all(at.toISOString()) as { id: string; chapterId: string }[];
  for (const r of rows) {
    db.transaction(() => applyTransition(r.id, "cancelled", `Released: not scheduled within ${config.claimReleaseHours} hours`))();
    logAudit(null, "claim_auto_released", { chapterId: r.chapterId, subjectType: "claim", subjectId: r.id });
    notifyClaimReleased(r.id);
  }
  return rows.length;
}

// ---- coordinator actions ------------------------------------------------------------------------------------------------------------
/** Cancel, mark a no-show, schedule a drop-off, or close a pickup as collected when the volunteers could not (with a reason). */
export function coordinatorTransition(actor: Actor, claimId: string, raw: unknown) {
  const c = loadClaim(claimId);
  requireCoordinator(actor, c.chapter_id);
  const input = coordinatorStatusSchema.parse(raw);
  if (c.method === "pickup" && input.status === "collected" && input.reason.length < 5) throw invalid("Say why you are closing this pickup as collected (a few words).");
  getDb().transaction(() => applyTransition(claimId, input.status, input.reason))();
  logAudit(actor.id, "claim_status_set", { chapterId: c.chapter_id, subjectType: "claim", subjectId: claimId, detail: { from: c.status, to: input.status } });
  if (input.status === "collected") notifyCollected(claimId);
  if (input.status === "scheduled" && c.method === "pickup") notifyPickupScheduled(claimId);
}

export type DropoffRow = { claimId: string; zoneId: string; zoneName: string; expectedDate: string; status: ClaimStatus; neighbourName: string | null; items: string };
/** Incoming drop-offs by zone and date (not yet counted). The neighbour shows only as a pseudonymous display name. */
export function listIncomingDropoffs(actor: Actor, chapterId: string): DropoffRow[] {
  requireCoordinator(actor, chapterId);
  const rows = getDb()
    .prepare(
      `SELECT c.id AS claimId, z.id AS zoneId, z.name AS zoneName, c.expected_date AS expectedDate, c.status, u.name AS neighbourName, c.request_id AS requestId, c.quantity
         FROM claim c JOIN zone z ON z.id = c.zone_id LEFT JOIN "user" u ON u.id = c.neighbour_id
        WHERE c.chapter_id = ? AND c.method = 'dropoff' AND c.status IN ('claimed','scheduled','collected') ORDER BY c.expected_date, z.name, c.created_at`,
    )
    .all(chapterId) as (Omit<DropoffRow, "items"> & { requestId: string; quantity: number })[];
  return rows.map(({ requestId, quantity, ...r }) => ({ ...r, items: `${quantity} × ${requestInfo(requestId).label}` }));
}

export type AwaitingReceipt = { claimId: string; method: ClaimMethod; status: ClaimStatus; neighbourName: string | null; expectedDate: string | null; zoneName: string | null; quantity: number; label: string; partnerName: string | null; requestStatus: RequestStatus };
/** Claims ready to be counted in: collected pickups, and drop-offs that have arrived. */
export function listAwaitingReceipt(actor: Actor, chapterId: string): AwaitingReceipt[] {
  requireCoordinator(actor, chapterId);
  const rows = getDb()
    .prepare(
      `SELECT c.id AS claimId, c.method, c.status, u.name AS neighbourName, c.expected_date AS expectedDate, z.name AS zoneName, c.quantity, c.request_id AS requestId
         FROM claim c LEFT JOIN "user" u ON u.id = c.neighbour_id LEFT JOIN zone z ON z.id = c.zone_id
        WHERE c.chapter_id = ? AND (c.status = 'collected' OR (c.method = 'dropoff' AND c.status IN ('claimed','scheduled'))) ORDER BY c.created_at`,
    )
    .all(chapterId) as (Omit<AwaitingReceipt, "label" | "partnerName" | "requestStatus"> & { requestId: string })[];
  return rows.map(({ requestId, ...r }) => {
    const q = requestInfo(requestId);
    return { ...r, label: q.label, partnerName: q.partnerName, requestStatus: q.status };
  });
}

/**
 * Counts a claim into fast stock. `quantity` is how many actually arrived (it can differ from the claim, down to zero),
 * and `extras` are items nobody claimed. Everything lands in stock first; then, if the request still needs units, up to
 * what it needs is allocated to it (so a request that was already filled from stock simply keeps the new units in stock).
 * One transaction: ledger rows, claim status and request status.
 */
export function receiveClaim(actor: Actor, claimId: string, raw: unknown) {
  const c = loadClaim(claimId);
  requireCoordinator(actor, c.chapter_id);
  const input = receiveSchema.parse(raw);
  if (!canTransition(c.method, c.status, "received")) {
    throw conflict("invalid_transition", `A ${c.method === "pickup" ? "pickup" : "drop-off"} claim that is “${c.status}” cannot be counted in.`);
  }
  const total = input.quantity + input.extras.reduce((n, e) => n + e.quantity, 0);
  if (total === 0) throw invalid("Nothing was received. Mark the claim as a no-show instead.");
  const db = getDb();
  let allocated = 0;
  db.transaction(() => {
    const r = loadRequest(c.request_id);
    if (input.quantity > 0) {
      appendLedger({ chapterId: c.chapter_id, itemId: r.item_id!, size: r.size, delta: input.quantity, kind: "received", claimId, requestId: r.id, note: input.note, actorId: actor.id });
      if (r.type !== "restock" && (r.status === "open" || r.status === "claimed")) {
        const need = Math.max(0, r.quantity - coverage(r).done);
        allocated = Math.min(input.quantity, need);
        if (allocated > 0) appendLedger({ chapterId: c.chapter_id, itemId: r.item_id!, size: r.size, delta: -allocated, kind: "allocated_to_request", claimId, requestId: r.id, actorId: actor.id });
      }
    }
    for (const e of input.extras) {
      const item = getItem(e.itemId);
      if (!item.active) throw invalid("One of the extra items is not in the catalog.");
      appendLedger({ chapterId: c.chapter_id, itemId: item.id, size: normalizeSize(item, e.size), delta: e.quantity, kind: "received", claimId, note: input.note || "Not claimed", actorId: actor.id });
    }
    applyTransition(claimId, "received", input.note);
    db.prepare("UPDATE claim SET received_quantity = ? WHERE id = ?").run(input.quantity, claimId);
    refreshRequest(c.request_id);
    syncRestock(c.chapter_id);
  })();
  logAudit(actor.id, "claim_received", { chapterId: c.chapter_id, subjectType: "claim", subjectId: claimId, detail: { units: total, allocated } });
  return { received: total, allocatedToRequest: allocated };
}

export type { RequestRow };
