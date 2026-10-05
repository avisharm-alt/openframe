// Shared request helpers: the live numbers (allocated, claimed, remaining) and the status refresh. No permissions
// here; callers (requests.ts, claims.ts, deliveries.ts) decide who may do what.
import { getDb, now } from "../db";
import { notFound } from "../errors";
import type { RequestStatus, RequestType, Urgency } from "../types";
import { notifyWorkerRequestClaimed, notifyWorkerRequestReady } from "./notifications";

export type RequestRow = {
  id: string; chapter_id: string; partner_id: string | null; delivery_site_id: string | null; type: RequestType; item_id: string | null; size: string;
  kit_template_id: string | null; quantity: number; needed_by: string; urgency: Urgency; note: string; status: RequestStatus; filled_from_stock: number;
  status_reason: string | null; created_by: string | null; created_at: string; updated_at: string; delivered_at: string | null; confirmed_at: string | null;
  confirmed_by: string | null; risk_notified_at: string | null;
};

export function loadRequest(id: string): RequestRow {
  const r = getDb().prepare("SELECT * FROM request WHERE id = ?").get(id) as RequestRow | undefined;
  if (!r) throw notFound("Request not found");
  return r;
}

/** Units of an item request already taken out of stock for it (from claims received, or filled from stock). */
export const allocatedQty = (requestId: string): number =>
  (getDb().prepare("SELECT COALESCE(-SUM(delta), 0) AS n FROM stock_ledger WHERE request_id = ? AND kind = 'allocated_to_request'").get(requestId) as { n: number }).n;

/** Units neighbours have committed to and that have not been counted in yet. */
export const claimedPending = (requestId: string): number =>
  (getDb().prepare("SELECT COALESCE(SUM(quantity), 0) AS n FROM claim WHERE request_id = ? AND status IN ('claimed','scheduled','collected')").get(requestId) as { n: number }).n;

/** For restock requests: units neighbours brought that were counted into stock. */
export const restockedQty = (requestId: string): number =>
  (getDb().prepare("SELECT COALESCE(SUM(received_quantity), 0) AS n FROM claim WHERE request_id = ? AND status = 'received'").get(requestId) as { n: number }).n;

export const allocatedKits = (requestId: string): number =>
  (getDb().prepare("SELECT COUNT(*) AS n FROM kit WHERE request_id = ?").get(requestId) as { n: number }).n;

/** How much of the request is already covered (allocated, or for restock counted in) plus pending claims. */
export function coverage(r: RequestRow): { done: number; pending: number; remaining: number } {
  const done = r.type === "kit" ? allocatedKits(r.id) : r.type === "restock" ? restockedQty(r.id) : allocatedQty(r.id);
  const pending = r.type === "kit" ? 0 : claimedPending(r.id);
  return { done, pending, remaining: Math.max(0, r.quantity - done - pending) };
}

/**
 * Recomputes open / claimed / in_transit from the claims and the stock allocations. Only requests that are still
 * open or claimed move: delivered, confirmed, cancelled and expired are never touched here.
 *  - item / kit: fully allocated -> in_transit (ready for a delivery run); fully committed -> claimed; else open.
 *  - restock: fully counted into stock -> confirmed (there is nothing to deliver); fully committed -> claimed; else open.
 * Returns the new status.
 */
export function refreshRequest(requestId: string): RequestStatus {
  const r = loadRequest(requestId);
  if (r.status !== "open" && r.status !== "claimed") return r.status;
  const c = coverage(r);
  let next: RequestStatus;
  if (c.done >= r.quantity) next = r.type === "restock" ? "confirmed" : "in_transit";
  else if (c.done + c.pending >= r.quantity) next = "claimed";
  else next = "open";
  if (next === r.status) return next;
  const t = now();
  getDb()
    .prepare("UPDATE request SET status = ?, updated_at = ?, delivered_at = CASE WHEN ? = 'confirmed' THEN ? ELSE delivered_at END, confirmed_at = CASE WHEN ? = 'confirmed' THEN ? ELSE confirmed_at END WHERE id = ?")
    .run(next, t, next, t, next, t, requestId);
  if (next === "claimed") notifyWorkerRequestClaimed(requestId);
  if (next === "in_transit") notifyWorkerRequestReady(requestId);
  return next;
}
