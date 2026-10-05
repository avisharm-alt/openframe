import { getDb, now, uid } from "../db";
import { config } from "../config";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { rateLimit } from "../ratelimit";
import { addDays, localDate, nowDate } from "../time";
import { favouriteSchema, requestSchema } from "../validation";
import type { Actor, ItemCategory, RequestStatus, RequestType, Urgency } from "../types";
import { logAudit } from "./audit";
import { canActForPartner, getChapter, getPartnerRef, requireAgencyWorker, requireCoordinator, isCoordinatorOf } from "./access";
import { applyTransition } from "./claims";
import { getItem, itemLabel, normalizeSize } from "./items";
import { allocateKits, assembledKitCount, getKitTemplate } from "./kits";
import { getSite } from "./partners";
import { allocatedKits, allocatedQty, coverage, loadRequest, refreshRequest, type RequestRow } from "./request-core";
import { syncRestock } from "./restock";
import { appendLedger, stockOf } from "./stock";

export const MAX_DAYS_AHEAD = 60;
export const REQUESTS_PER_HOUR = 30;

// ---- the public board ----------------------------------------------------------------------------------------------------------

export type BoardCard = {
  requestId: string; type: RequestType; label: string; itemId: string | null; category: ItemCategory | "kit"; size: string; unit: string; newOnly: boolean;
  quantity: number; remaining: number; partnerName: string | null; siteName: string | null; neededBy: string; urgency: Urgency; note: string; excluded: string; claimable: boolean;
};
export type BoardFilters = { category?: string; size?: string };

type JoinRow = RequestRow & { item_name: string | null; category: ItemCategory | null; unit: string | null; new_only: number | null; kit_name: string | null; partner_name: string | null; site_name: string | null; excluded_items: string | null };
const JOIN_SQL = `SELECT q.*, i.name AS item_name, i.category, i.unit, i.new_only, k.name AS kit_name, p.name AS partner_name, s.name AS site_name, p.excluded_items
  FROM request q LEFT JOIN item i ON i.id = q.item_id LEFT JOIN kit_template k ON k.id = q.kit_template_id LEFT JOIN partner p ON p.id = q.partner_id LEFT JOIN delivery_site s ON s.id = q.delivery_site_id`;

/**
 * The live request board: open requests with something still unclaimed, most urgent first, then soonest needed-by.
 * Public: no account needed. Restock requests (type "restock") are the chapter's own and carry no partner.
 */
export function listBoard(chapterId: string, filters: BoardFilters = {}): BoardCard[] {
  const rows = getDb().prepare(`${JOIN_SQL} WHERE q.chapter_id = ? AND q.status = 'open'`).all(chapterId) as JoinRow[];
  const cards: BoardCard[] = [];
  for (const r of rows) {
    const { remaining } = coverage(r);
    if (remaining <= 0) continue;
    const category = r.type === "kit" ? "kit" : r.category!;
    if (filters.category && filters.category !== category) continue;
    if (filters.size && r.size !== filters.size.toUpperCase()) continue;
    cards.push({
      requestId: r.id, type: r.type, label: r.type === "kit" ? r.kit_name! : itemLabel(r.item_name!, r.size), itemId: r.item_id, category, size: r.size, unit: r.type === "kit" ? "kit" : r.unit!,
      newOnly: r.type === "kit" ? true : !!r.new_only, quantity: r.quantity, remaining, partnerName: r.partner_name, siteName: r.site_name, neededBy: r.needed_by, urgency: r.urgency,
      note: r.note, excluded: r.excluded_items ?? "", claimable: r.type !== "kit",
    });
  }
  return cards.sort((a, b) => Number(b.urgency === "urgent") - Number(a.urgency === "urgent") || a.neededBy.localeCompare(b.neededBy) || a.label.localeCompare(b.label));
}

/** One open board card by id (for the claim page); null when it is not open or has nothing left to claim. */
export function getBoardCard(requestId: string): BoardCard | null {
  const r = getDb().prepare(`${JOIN_SQL} WHERE q.id = ? AND q.status = 'open'`).get(requestId) as JoinRow | undefined;
  if (!r) return null;
  return listBoard(r.chapter_id).find((c) => c.requestId === requestId) ?? null;
}

// ---- agency workers post requests ---------------------------------------------------------------------------------------------------

/**
 * An approved agency worker posts a request: an item (with size when it has one) or N kits from a template, needed by a
 * date, for one of their partner's delivery sites. The note is short and screened for contact details; the UI warns
 * workers never to include anything that could identify a person.
 */
export function createRequest(actor: Actor, raw: unknown, at: Date = nowDate()): { id: string } {
  rateLimit(`request:${actor.id}`, REQUESTS_PER_HOUR, 3600_000);
  const input = requestSchema.parse(raw);
  requireAgencyWorker(actor, input.partnerId);
  const partner = getPartnerRef(input.partnerId);
  const site = getSite(input.siteId);
  if (site.partnerId !== partner.id || !site.active) throw invalid("Choose one of your partner's active delivery sites.");
  const chapter = getChapter(partner.chapterId);
  const today = localDate(chapter.timezone, at);
  if (input.neededBy < today || input.neededBy > addDays(today, MAX_DAYS_AHEAD)) throw invalid("Choose a needed-by date from today to 60 days ahead.");
  let itemId: string | null = null, size = "", kitId: string | null = null;
  if (input.type === "item") {
    const item = getItem(input.itemId);
    if (!item.active) throw invalid("That item is no longer in the catalog.");
    itemId = item.id;
    size = normalizeSize(item, input.size);
  } else {
    const kit = getKitTemplate(input.kitTemplateId);
    if (kit.chapterId !== chapter.id || !kit.active) throw invalid("Choose one of this chapter's active kit templates.");
    kitId = kit.id;
  }
  const id = uid();
  getDb()
    .prepare(
      "INSERT INTO request (id, chapter_id, partner_id, delivery_site_id, type, item_id, size, kit_template_id, quantity, needed_by, urgency, note, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)",
    )
    .run(id, chapter.id, partner.id, site.id, input.type, itemId, size, kitId, input.quantity, input.neededBy, input.urgency, input.note, actor.id, now(), now());
  logAudit(actor.id, "request_created", { chapterId: chapter.id, subjectType: "request", subjectId: id, detail: { type: input.type, partnerId: partner.id } });
  return { id };
}

/** Workers cancel their own partner's open or claimed requests; a coordinator can also cancel one that is already on its way (its stock goes back). */
export function cancelRequest(actor: Actor, requestId: string, reason = "Cancelled") {
  const r = loadRequest(requestId);
  const coordinator = isCoordinatorOf(actor, r.chapter_id);
  if (r.partner_id ? !canActForPartner(actor, r.partner_id) : !coordinator) throw notFound("Request not found");
  const cancellable: RequestStatus[] = coordinator ? ["open", "claimed", "in_transit"] : ["open", "claimed"];
  if (!cancellable.includes(r.status)) throw conflict("not_cancellable", "This request can no longer be cancelled.");
  const db = getDb();
  db.transaction(() => {
    // Neighbours who have not handed anything over yet are released. Items already collected will land in stock when counted in.
    for (const c of db.prepare("SELECT id FROM claim WHERE request_id = ? AND status IN ('claimed','scheduled')").all(requestId) as { id: string }[]) applyTransition(c.id, "cancelled", "The request was cancelled");
    if (r.status === "in_transit") {
      const back = allocatedQty(requestId);
      if (back > 0) appendLedger({ chapterId: r.chapter_id, itemId: r.item_id!, size: r.size, delta: back, kind: "adjusted", requestId, note: "Request cancelled: returned to stock", actorId: actor.id });
      db.prepare("UPDATE kit SET status = 'assembled', request_id = NULL WHERE request_id = ?").run(requestId);
      db.prepare("DELETE FROM delivery_request WHERE request_id = ? AND delivery_id IN (SELECT id FROM delivery WHERE status = 'planned')").run(requestId);
    }
    db.prepare("UPDATE request SET status = 'cancelled', status_reason = ?, updated_at = ? WHERE id = ?").run(reason, now(), requestId);
    syncRestock(r.chapter_id);
  })();
  logAudit(actor.id, "request_cancelled", { chapterId: r.chapter_id, subjectType: "request", subjectId: requestId });
}

// ---- fill from stock -------------------------------------------------------------------------------------------------------------------

/**
 * Fills a request from fast stock in one step: the units are allocated out of stock (or assembled kits are allocated) and
 * the request goes straight to `in_transit`, ready for a delivery run. Neighbours who had claimed some of it keep their
 * claim, and what they bring goes into stock. Coordinators of the request's chapter only.
 */
export function fillFromStock(actor: Actor, requestId: string) {
  const r = loadRequest(requestId);
  requireCoordinator(actor, r.chapter_id);
  if (r.type === "restock") throw conflict("restock_request", "Restock requests are filled by neighbours. Adjust stock instead.");
  if (r.status !== "open" && r.status !== "claimed") throw conflict("not_fillable", "Only an open or claimed request can be filled from stock.");
  const db = getDb();
  db.transaction(() => {
    if (r.type === "kit") {
      allocateKits(r.chapter_id, r.kit_template_id!, requestId, r.quantity - allocatedKits(requestId));
    } else {
      const need = r.quantity - allocatedQty(requestId);
      const have = stockOf(r.chapter_id, r.item_id!, r.size);
      if (have < need) throw conflict("insufficient_stock", `Not enough stock to fill this request: ${have} on the shelf, ${need} needed.`, { have, need });
      appendLedger({ chapterId: r.chapter_id, itemId: r.item_id!, size: r.size, delta: -need, kind: "allocated_to_request", requestId, note: "Filled from stock", actorId: actor.id });
    }
    db.prepare("UPDATE request SET filled_from_stock = 1 WHERE id = ?").run(requestId);
    refreshRequest(requestId);
    syncRestock(r.chapter_id);
  })();
  logAudit(actor.id, "request_filled_from_stock", { chapterId: r.chapter_id, subjectType: "request", subjectId: requestId });
  return { status: loadRequest(requestId).status };
}

// ---- triage (coordinators) and the partner's own list -----------------------------------------------------------------------------------

export type RequestTriage = {
  id: string; type: RequestType; label: string; partnerName: string | null; siteName: string | null; neededBy: string; urgency: Urgency; note: string; status: RequestStatus;
  quantity: number; done: number; pending: number; remaining: number; stockAvailable: number; canFill: boolean; atRisk: boolean; overdue: boolean; daysLeft: number; createdAt: string;
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400_000);

function toTriage(r: JoinRow, today: string): RequestTriage {
  const c = coverage(r);
  const daysLeft = daysBetween(today, r.needed_by);
  const live = r.status === "open" || r.status === "claimed";
  const need = r.quantity - c.done;
  const stockAvailable = r.type === "kit" ? assembledKitCount(r.chapter_id, r.kit_template_id!) : stockOf(r.chapter_id, r.item_id!, r.size);
  return {
    id: r.id, type: r.type, label: r.type === "kit" ? r.kit_name! : itemLabel(r.item_name!, r.size), partnerName: r.partner_name, siteName: r.site_name, neededBy: r.needed_by, urgency: r.urgency,
    note: r.note, status: r.status, quantity: r.quantity, done: c.done, pending: c.pending, remaining: c.remaining, stockAvailable,
    canFill: live && r.type !== "restock" && need > 0 && stockAvailable >= need,
    atRisk: live && daysLeft <= config.requestRiskDays, overdue: (live || r.status === "in_transit") && daysLeft < 0, daysLeft, createdAt: r.created_at,
  };
}

/** The coordinator's triage view: live requests first, at-risk ones (needed-by approaching and still unfilled) highlighted at the top. */
export function listRequests(actor: Actor, chapterId: string, at: Date = nowDate()): RequestTriage[] {
  requireCoordinator(actor, chapterId);
  const today = localDate(getChapter(chapterId).timezone, at);
  const rows = getDb().prepare(`${JOIN_SQL} WHERE q.chapter_id = ? AND q.status IN ('open','claimed','in_transit','delivered') ORDER BY q.created_at`).all(chapterId) as JoinRow[];
  const live = (s: RequestStatus) => (s === "open" || s === "claimed" ? 0 : 1);
  return rows
    .map((r) => toTriage(r, today))
    .sort((a, b) => live(a.status) - live(b.status) || Number(b.atRisk) - Number(a.atRisk) || Number(b.urgency === "urgent") - Number(a.urgency === "urgent") || a.neededBy.localeCompare(b.neededBy));
}

/** "My partner's requests": status for the partner's workers (and the chapter's coordinators). */
export function listPartnerRequests(actor: Actor, partnerId: string, at: Date = nowDate()): (RequestTriage & { canConfirm: boolean; deliveredAt: string | null })[] {
  if (!canActForPartner(actor, partnerId)) throw forbidden("Agency worker access for this partner is required.");
  const today = localDate(getChapter(getPartnerRef(partnerId).chapterId).timezone, at);
  const rows = getDb().prepare(`${JOIN_SQL} WHERE q.partner_id = ? ORDER BY q.created_at DESC, q.rowid DESC LIMIT 100`).all(partnerId) as JoinRow[];
  return rows.map((r) => ({ ...toTriage(r, today), canConfirm: r.status === "delivered", deliveredAt: r.delivered_at }));
}

// ---- repeat last request and favourites -------------------------------------------------------------------------------------------------
export type RequestTemplate = { itemId: string; size: string; quantity: number; siteId: string | null; urgency: Urgency };

/** The worker's most recent item request for this partner, to post again in one tap. */
export function lastRequest(actor: Actor, partnerId: string): RequestTemplate | null {
  requireAgencyWorker(actor, partnerId);
  const r = getDb()
    .prepare("SELECT item_id AS itemId, size, quantity, delivery_site_id AS siteId, urgency FROM request WHERE partner_id = ? AND created_by = ? AND type = 'item' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(partnerId, actor.id) as RequestTemplate | undefined;
  return r ?? null;
}

export type Favourite = RequestTemplate & { id: string; label: string };
export function listFavourites(actor: Actor, partnerId: string): Favourite[] {
  requireAgencyWorker(actor, partnerId);
  const rows = getDb()
    .prepare("SELECT f.id, f.item_id AS itemId, f.size, f.quantity, f.delivery_site_id AS siteId, f.urgency, i.name FROM request_favourite f JOIN item i ON i.id = f.item_id WHERE f.partner_id = ? AND f.user_id = ? ORDER BY f.created_at")
    .all(partnerId, actor.id) as (RequestTemplate & { id: string; name: string })[];
  return rows.map(({ name, ...f }) => ({ ...f, label: itemLabel(name, f.size) }));
}
export function saveFavourite(actor: Actor, partnerId: string, raw: unknown): { id: string } {
  requireAgencyWorker(actor, partnerId);
  const input = favouriteSchema.parse(raw);
  const item = getItem(input.itemId);
  const size = normalizeSize(item, input.size);
  if (input.siteId && getSite(input.siteId).partnerId !== partnerId) throw invalid("Choose one of your partner's delivery sites.");
  const db = getDb();
  if ((db.prepare("SELECT COUNT(*) AS n FROM request_favourite WHERE partner_id = ? AND user_id = ?").get(partnerId, actor.id) as { n: number }).n >= 20) throw conflict("too_many_favourites", "You can keep up to 20 favourites. Remove one first.");
  const id = uid();
  db.prepare("INSERT INTO request_favourite (id, partner_id, user_id, item_id, size, quantity, delivery_site_id, urgency, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, partnerId, actor.id, item.id, size, input.quantity, input.siteId ?? null, input.urgency, now());
  return { id };
}
export function deleteFavourite(actor: Actor, favouriteId: string) {
  const r = getDb().prepare("DELETE FROM request_favourite WHERE id = ? AND user_id = ?").run(favouriteId, actor.id);
  if (!r.changes) throw notFound("Favourite not found");
}
