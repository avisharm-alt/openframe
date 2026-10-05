import { getDb, now } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { hoursFrom, nowDate } from "../time";
import { deliverySchema, assignSchema } from "../validation";
import type { Actor, RequestStatus, Urgency } from "../types";
import { logAudit } from "./audit";
import { canActForPartner, isCoordinatorOf, requireCoordinator } from "./access";
import { itemLabel } from "./items";
import { notifyDelivered, notifyDeliveryAssigned, notifyWorkerDelivered, notifyWorkerDeliveryOnTheWay } from "./notifications";
import { loadRequest } from "./request-core";
import { safetyAcknowledgedAt } from "./safety";
import { getSite } from "./partners";
import { uid } from "../db";

// A delivery is a batch of requests taken to ONE delivery site by volunteers. They hand items to agency staff, who hand
// them to the person: students never deal with recipients. The agency worker confirms receipt in the app (or a coordinator records it).

type DRow = { id: string; chapter_id: string; delivery_site_id: string; status: "planned" | "out" | "completed"; planned_for: string; started_at: string | null; completed_at: string | null };
function loadDelivery(id: string): DRow {
  const r = getDb().prepare("SELECT * FROM delivery WHERE id = ?").get(id) as DRow | undefined;
  if (!r) throw notFound("Delivery not found");
  return r;
}
const volunteersOf = (id: string) => getDb().prepare('SELECT u.id, u.name FROM delivery_volunteer v JOIN "user" u ON u.id = v.user_id WHERE v.delivery_id = ? ORDER BY v.assigned_at, v.rowid').all(id) as { id: string; name: string }[];

export type Deliverable = { requestId: string; label: string; partnerName: string; siteId: string; siteName: string; neededBy: string; urgency: Urgency };

/** Requests that are in hand (on their way) and not yet in a delivery batch, ready to be grouped by site. */
export function listDeliverables(actor: Actor, chapterId: string): Deliverable[] {
  requireCoordinator(actor, chapterId);
  return (
    getDb()
      .prepare(
        `SELECT q.id AS requestId, COALESCE(i.name, k.name) AS name, q.size, p.name AS partnerName, s.id AS siteId, s.name AS siteName, q.needed_by AS neededBy, q.urgency, q.quantity
           FROM request q LEFT JOIN item i ON i.id = q.item_id LEFT JOIN kit_template k ON k.id = q.kit_template_id JOIN partner p ON p.id = q.partner_id JOIN delivery_site s ON s.id = q.delivery_site_id
          WHERE q.chapter_id = ? AND q.status = 'in_transit' AND q.type <> 'restock' AND NOT EXISTS (SELECT 1 FROM delivery_request dr WHERE dr.request_id = q.id)
          ORDER BY s.name, q.urgency DESC, q.needed_by`,
      )
      .all(chapterId) as (Omit<Deliverable, "label"> & { name: string; size: string; quantity: number })[]
  ).map(({ name, size, quantity, ...d }) => ({ ...d, label: `${quantity} × ${itemLabel(name, size)}` }));
}

export function createDelivery(actor: Actor, chapterId: string, raw: unknown): { id: string } {
  requireCoordinator(actor, chapterId);
  const input = deliverySchema.parse(raw);
  const site = getSite(input.siteId);
  const db = getDb();
  const owner = db.prepare("SELECT chapter_id AS chapterId FROM partner WHERE id = ?").get(site.partnerId) as { chapterId: string } | undefined;
  if (!owner || owner.chapterId !== chapterId) throw notFound("Delivery site not found");
  const id = uid();
  db.transaction(() => {
    db.prepare("INSERT INTO delivery (id, chapter_id, delivery_site_id, status, planned_for, created_by, created_at) VALUES (?,?,?,'planned',?,?,?)").run(id, chapterId, site.id, input.plannedFor, actor.id, now());
    for (const rid of new Set(input.requestIds)) {
      const r = loadRequest(rid);
      if (r.chapter_id !== chapterId || r.delivery_site_id !== site.id) throw invalid("All requests in a delivery must be for the same delivery site.");
      if (r.status !== "in_transit") throw conflict("not_ready", "Only requests that are in hand (on their way) can go on a delivery.");
      if (db.prepare("SELECT 1 FROM delivery_request WHERE request_id = ?").get(rid)) throw conflict("already_in_delivery", "One of those requests is already on a delivery.");
      db.prepare("INSERT INTO delivery_request (delivery_id, request_id) VALUES (?,?)").run(id, rid);
    }
  })();
  logAudit(actor.id, "delivery_created", { chapterId, subjectType: "delivery", subjectId: id, detail: { requests: input.requestIds.length } });
  return { id };
}

export function assignDeliveryVolunteer(actor: Actor, deliveryId: string, raw: unknown) {
  const d = loadDelivery(deliveryId);
  requireCoordinator(actor, d.chapter_id);
  const { volunteerId } = assignSchema.parse(raw);
  if (d.status === "completed") throw conflict("delivery_done", "This delivery is already completed.");
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM chapter_member WHERE chapter_id = ? AND user_id = ?").get(d.chapter_id, volunteerId)) throw invalid("That person is not a volunteer in this chapter.");
  if (!safetyAcknowledgedAt(volunteerId)) throw conflict("safety_not_acknowledged", "This volunteer has not acknowledged the Safety rules yet.");
  if (db.prepare("SELECT 1 FROM delivery_volunteer WHERE delivery_id = ? AND user_id = ?").get(deliveryId, volunteerId)) throw conflict("already_assigned", "That volunteer is already on this delivery.");
  db.prepare("INSERT INTO delivery_volunteer (delivery_id, user_id, assigned_by, assigned_at) VALUES (?,?,?,?)").run(deliveryId, volunteerId, actor.id, now());
  logAudit(actor.id, "delivery_volunteer_assigned", { chapterId: d.chapter_id, subjectType: "delivery", subjectId: deliveryId, detail: { volunteerId } });
  notifyDeliveryAssigned(deliveryId, volunteerId);
}
export function removeDeliveryVolunteer(actor: Actor, deliveryId: string, volunteerId: string) {
  const d = loadDelivery(deliveryId);
  requireCoordinator(actor, d.chapter_id);
  if (d.status !== "planned") throw conflict("delivery_started", "A delivery that is out or completed cannot change volunteers.");
  const r = getDb().prepare("DELETE FROM delivery_volunteer WHERE delivery_id = ? AND user_id = ?").run(deliveryId, volunteerId);
  if (!r.changes) throw notFound("That volunteer is not on this delivery.");
}

const canRun = (actor: Actor, d: DRow) => isCoordinatorOf(actor, d.chapter_id) || !!getDb().prepare("SELECT 1 FROM delivery_volunteer WHERE delivery_id = ? AND user_id = ?").get(d.id, actor.id);

/** "Out for delivery": needs at least one assigned volunteer. Tells each request's worker that it is on the way. */
export function startDelivery(actor: Actor, deliveryId: string) {
  const d = loadDelivery(deliveryId);
  if (!canRun(actor, d)) throw notFound("Delivery not found");
  if (d.status !== "planned") throw conflict("delivery_started", "This delivery has already started.");
  if (volunteersOf(deliveryId).length === 0) throw conflict("no_volunteers", "Assign at least one volunteer before the delivery goes out.");
  const db = getDb();
  db.prepare("UPDATE delivery SET status = 'out', started_at = ? WHERE id = ?").run(now(), deliveryId);
  const ids = db.prepare("SELECT request_id AS id FROM delivery_request WHERE delivery_id = ?").all(deliveryId) as { id: string }[];
  for (const r of ids) notifyWorkerDeliveryOnTheWay(r.id);
  logAudit(actor.id, "delivery_started", { chapterId: d.chapter_id, subjectType: "delivery", subjectId: deliveryId });
}

/** Marks everything in the batch delivered to the site. The neighbours whose items it contains hear "Delivered to [partner]". */
export function completeDelivery(actor: Actor, deliveryId: string) {
  const d = loadDelivery(deliveryId);
  if (!canRun(actor, d)) throw notFound("Delivery not found");
  if (d.status !== "out") throw conflict("delivery_not_out", d.status === "planned" ? "Start the delivery first." : "This delivery is already completed.");
  const db = getDb();
  const ids = db.prepare("SELECT request_id AS id FROM delivery_request WHERE delivery_id = ?").all(deliveryId) as { id: string }[];
  const t = now();
  db.transaction(() => {
    db.prepare("UPDATE delivery SET status = 'completed', completed_at = ? WHERE id = ?").run(t, deliveryId);
    db.prepare("UPDATE request SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE status = 'in_transit' AND id IN (SELECT request_id FROM delivery_request WHERE delivery_id = ?)").run(t, t, deliveryId);
  })();
  logAudit(actor.id, "delivery_completed", { chapterId: d.chapter_id, subjectType: "delivery", subjectId: deliveryId });
  for (const r of ids) {
    notifyWorkerDelivered(r.id);
    notifyDelivered(r.id);
  }
}

/** The agency worker confirms receipt in the app (or a coordinator records the confirmation for them). */
export function confirmReceipt(actor: Actor, requestId: string) {
  const r = loadRequest(requestId);
  const coordinator = isCoordinatorOf(actor, r.chapter_id);
  if (!r.partner_id || !(canActForPartner(actor, r.partner_id) || coordinator)) throw notFound("Request not found");
  if (r.status !== "delivered") throw conflict("not_delivered", r.status === "confirmed" ? "Receipt is already confirmed." : "This request has not been delivered yet.");
  getDb().prepare("UPDATE request SET status = 'confirmed', confirmed_at = ?, confirmed_by = ?, updated_at = ? WHERE id = ?").run(now(), actor.id, now(), requestId);
  logAudit(actor.id, "request_confirmed", { chapterId: r.chapter_id, subjectType: "request", subjectId: requestId, detail: { by: coordinator && !canActForPartner(actor, r.partner_id) ? "coordinator" : "agency" } });
}

export type DeliveryView = {
  id: string; status: DRow["status"]; plannedFor: string; startedAt: string | null; completedAt: string | null;
  site: { id: string; name: string; address: string; receivingHours: string; partnerName: string };
  requests: { id: string; label: string; status: RequestStatus }[]; volunteers: { id: string; name: string }[];
  canStart: boolean; canComplete: boolean;
};
function toView(d: DRow): DeliveryView {
  const db = getDb();
  const site = db.prepare("SELECT s.id, s.name, s.address, s.receiving_hours AS receivingHours, p.name AS partnerName FROM delivery_site s JOIN partner p ON p.id = s.partner_id WHERE s.id = ?").get(d.delivery_site_id) as DeliveryView["site"];
  const requests = (
    db.prepare(`SELECT q.id, q.status, q.quantity, q.size, COALESCE(i.name, k.name) AS name FROM delivery_request dr JOIN request q ON q.id = dr.request_id LEFT JOIN item i ON i.id = q.item_id LEFT JOIN kit_template k ON k.id = q.kit_template_id WHERE dr.delivery_id = ? ORDER BY q.created_at`).all(d.id) as { id: string; status: RequestStatus; quantity: number; size: string; name: string }[]
  ).map((r) => ({ id: r.id, status: r.status, label: `${r.quantity} × ${itemLabel(r.name, r.size)}` }));
  const vols = volunteersOf(d.id);
  return { id: d.id, status: d.status, plannedFor: d.planned_for, startedAt: d.started_at, completedAt: d.completed_at, site, requests, volunteers: vols, canStart: d.status === "planned" && vols.length > 0, canComplete: d.status === "out" };
}

export function listDeliveries(actor: Actor, chapterId: string, at: Date = nowDate()): DeliveryView[] {
  requireCoordinator(actor, chapterId);
  const since = hoursFrom(at, -24 * 14).toISOString();
  return (getDb().prepare("SELECT * FROM delivery WHERE chapter_id = ? AND (status <> 'completed' OR completed_at >= ?) ORDER BY planned_for DESC, created_at DESC").all(chapterId, since) as DRow[]).map(toView);
}

/** My delivery batch: what to take where, and the site's receiving hours. Open ones, plus anything completed in the last week. */
export function myDeliveries(actor: Actor, at: Date = nowDate()): DeliveryView[] {
  const since = hoursFrom(at, -24 * 7).toISOString();
  const rows = getDb()
    .prepare("SELECT d.* FROM delivery d JOIN delivery_volunteer v ON v.delivery_id = d.id WHERE v.user_id = ? AND (d.status <> 'completed' OR d.completed_at >= ?) ORDER BY d.planned_for")
    .all(actor.id, since) as DRow[];
  return rows.map(toView);
}
