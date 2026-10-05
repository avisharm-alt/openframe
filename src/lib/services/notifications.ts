import { getDb } from "../db";
import { config } from "../config";
import { queueEmail } from "../email";
import { formatLocal, formatTime } from "../time";

// Plain-text emails. They never contain a pickup address, phone number or access note, and never anything about a recipient.

const emailOf = (userId: string | null): string | null => {
  if (!userId) return null;
  const r = getDb().prepare('SELECT email FROM "user" WHERE id = ?').get(userId) as { email: string } | undefined;
  return r?.email ?? null;
};
const send = (userId: string | null, template: string, subject: string, text: string) => {
  const to = emailOf(userId);
  if (to) queueEmail({ to, template, subject, text: `${text}\n\n— OpenFrame\n${config.baseUrl}` });
};

/** "4 × Men's winter boots (size 11)" or "20 × Winter outreach kit". */
function requestLabel(requestId: string): string {
  const r = getDb()
    .prepare(
      `SELECT q.quantity, q.size, q.type, COALESCE(i.name, k.name) AS name FROM request q LEFT JOIN item i ON i.id = q.item_id LEFT JOIN kit_template k ON k.id = q.kit_template_id WHERE q.id = ?`,
    )
    .get(requestId) as { quantity: number; size: string; name: string } | undefined;
  return r ? `${r.quantity} × ${r.name}${r.size ? ` (size ${r.size})` : ""}` : "your request";
}

type ClaimCtx = { neighbourId: string | null; method: string; quantity: number; requestId: string; chapter: string; timezone: string; partner: string | null; item: string; size: string; zone: string | null; expectedDate: string | null; pickupId: string | null; releaseAt: string | null };
function claimCtx(claimId: string): ClaimCtx | null {
  return (
    (getDb()
      .prepare(
        `SELECT c.neighbour_id AS neighbourId, c.method, c.quantity, c.request_id AS requestId, ch.name AS chapter, ch.timezone, p.name AS partner,
                COALESCE(i.name, 'items') AS item, q.size, z.name AS zone, c.expected_date AS expectedDate, pk.id AS pickupId, c.release_at AS releaseAt
           FROM claim c JOIN request q ON q.id = c.request_id JOIN chapter ch ON ch.id = c.chapter_id LEFT JOIN partner p ON p.id = q.partner_id
           LEFT JOIN item i ON i.id = q.item_id LEFT JOIN zone z ON z.id = c.zone_id LEFT JOIN pickup pk ON pk.claim_id = c.id WHERE c.id = ?`,
      )
      .get(claimId) as ClaimCtx | undefined) ?? null
  );
}
const claimText = (c: ClaimCtx) => `${c.quantity} × ${c.item}${c.size ? ` (size ${c.size})` : ""}`;
const forWhom = (c: ClaimCtx) => (c.partner ? `for ${c.partner}` : `to restock ${c.chapter}'s fast stock`);

function chosenWindow(pickupId: string): { startAt: string; endAt: string } | null {
  return (
    (getDb().prepare("SELECT w.start_at AS startAt, w.end_at AS endAt FROM pickup p JOIN pickup_window w ON w.id = p.scheduled_window_id WHERE p.id = ?").get(pickupId) as { startAt: string; endAt: string } | undefined) ?? null
  );
}

// ---- neighbour -----------------------------------------------------------------------------------------------------------
export function notifyClaimConfirmed(claimId: string) {
  const c = claimCtx(claimId);
  if (!c) return;
  const how = c.method === "dropoff" ? `You chose to drop off at ${c.zone} on ${c.expectedDate}.` : "You chose a pickup. A coordinator will confirm one of your windows and assign two volunteers. If it is not scheduled within 48 hours, the request goes back on the board so someone else can help.";
  send(c.neighbourId, "claim_confirmed", `You claimed a request ${forWhom(c)}`, `Thank you! You committed to ${claimText(c)} ${forWhom(c)}.\n${how}\nSee or change it any time under My claims.`);
}
export function notifyClaimReleased(claimId: string) {
  const c = claimCtx(claimId);
  if (!c) return;
  send(c.neighbourId, "claim_released", "Your claim was released", `Your pickup claim for ${claimText(c)} was not scheduled within 48 hours, so it went back on the board. You are welcome to claim it again or choose a drop-off.`);
}
export function notifyPickupScheduled(claimId: string) {
  const c = claimCtx(claimId);
  if (!c || !c.pickupId) return;
  const w = chosenWindow(c.pickupId);
  if (!w) return;
  send(
    c.neighbourId, "pickup_scheduled", "Your pickup is scheduled",
    `Your pickup of ${claimText(c)} is scheduled for ${formatLocal(w.startAt, c.timezone)} to ${formatTime(w.endAt, c.timezone)}.\n` +
      "Two volunteers will come together, in daytime. Please hand the items over at the door: they will not come inside. Their arrival is shown on your My claims page.",
  );
}
export function notifyCollected(claimId: string) {
  const c = claimCtx(claimId);
  if (!c) return;
  send(c.neighbourId, "claim_collected", "Your items were collected", `The volunteers collected ${claimText(c)}. Thank you! We will count them in and get them to ${c.partner ?? "our fast stock"}.`);
}
/** The feedback loop: every neighbour whose items went into this request hears where they ended up. */
export function notifyDelivered(requestId: string) {
  const rows = getDb()
    .prepare(
      `SELECT c.id FROM claim c WHERE c.request_id = ? AND c.status = 'received' AND COALESCE(c.received_quantity, 0) > 0 AND c.neighbour_id IS NOT NULL`,
    )
    .all(requestId) as { id: string }[];
  const q = getDb().prepare("SELECT p.name AS partner, q.delivered_at AS at, ch.timezone FROM request q JOIN partner p ON p.id = q.partner_id JOIN chapter ch ON ch.id = q.chapter_id WHERE q.id = ?").get(requestId) as { partner: string; at: string; timezone: string } | undefined;
  if (!q) return;
  for (const r of rows) {
    const c = claimCtx(r.id);
    if (c) send(c.neighbourId, "claim_delivered", `Delivered to ${q.partner}`, `Good news: ${claimText(c)} you gave was delivered to ${q.partner} on ${formatLocal(q.at, q.timezone).split(",").slice(0, 2).join(",")}. Their staff will hand it to someone who needs it. Thank you for making that happen.`);
  }
}

// ---- agency worker -------------------------------------------------------------------------------------------------------
export function notifyWorkerRequestClaimed(requestId: string) {
  const q = getDb().prepare("SELECT created_by AS by, type FROM request WHERE id = ?").get(requestId) as { by: string | null; type: string } | undefined;
  if (!q || q.type === "restock") return;
  send(q.by, "request_claimed", "A neighbour claimed your request", `Your request for ${requestLabel(requestId)} was claimed by a neighbour. We will tell you when the delivery is on its way.`);
}
export function notifyWorkerRequestReady(requestId: string) {
  const q = getDb().prepare("SELECT created_by AS by, type FROM request WHERE id = ?").get(requestId) as { by: string | null; type: string } | undefined;
  if (!q || q.type === "restock") return;
  send(q.by, "request_ready", "Your request is ready for delivery", `Your request for ${requestLabel(requestId)} is in hand and waiting for a delivery run to your site.`);
}
export function notifyWorkerDeliveryOnTheWay(requestId: string) {
  const q = getDb().prepare("SELECT created_by AS by FROM request WHERE id = ?").get(requestId) as { by: string | null } | undefined;
  if (q) send(q.by, "delivery_on_the_way", "Your delivery is on the way", `${requestLabel(requestId)} is on its way to your site with student volunteers. Please confirm receipt in OpenFrame once it arrives.`);
}
export function notifyWorkerDelivered(requestId: string) {
  const q = getDb().prepare("SELECT created_by AS by FROM request WHERE id = ?").get(requestId) as { by: string | null } | undefined;
  if (q) send(q.by, "request_delivered", "Delivered: please confirm", `${requestLabel(requestId)} was delivered to your site. Please confirm receipt in OpenFrame so the neighbour who gave it can see it arrived.`);
}

// ---- volunteer -----------------------------------------------------------------------------------------------------------
export function notifyVolunteerAssigned(pickupId: string, volunteerId: string) {
  const r = getDb().prepare("SELECT 1 FROM pickup WHERE id = ?").get(pickupId);
  if (!r) return;
  send(volunteerId, "volunteer_assigned", "You have a new pickup assignment", "A coordinator assigned you to a pickup. Open My pickups to see the window and your partner. The address is shown there starting 24 hours before the window. Remember: pairs only, daytime, doorstep handoff.");
}
export function notifyDeliveryAssigned(deliveryId: string, volunteerId: string) {
  const d = getDb().prepare("SELECT d.planned_for AS date, s.name AS site, s.receiving_hours AS hours FROM delivery d JOIN delivery_site s ON s.id = d.delivery_site_id WHERE d.id = ?").get(deliveryId) as { date: string; site: string; hours: string } | undefined;
  if (d) send(volunteerId, "delivery_assigned", "You have a delivery run", `You are on the delivery to ${d.site} planned for ${d.date}. Receiving hours: ${d.hours || "check with the coordinator"}. Hand items to agency staff only: never to the people they serve.`);
}
export function notifyShiftReminder(userId: string, label: string, startAtIso: string, timezone: string) {
  send(userId, "shift_reminder", "Shift reminder", `Your shift “${label}” starts ${formatLocal(startAtIso, timezone)}. Pickups and deliveries for your shift are in My pickups.`);
}

// ---- coordinators --------------------------------------------------------------------------------------------------------
function coordinatorsOf(chapterId: string): string[] {
  return (getDb().prepare("SELECT user_id AS id FROM chapter_member WHERE chapter_id = ? AND role = 'coordinator'").all(chapterId) as { id: string }[]).map((c) => c.id);
}
export function notifyCoordinatorsOverdue(pickupId: string) {
  const r = getDb()
    .prepare("SELECT p.chapter_id AS chapterId, c.name AS chapter, c.timezone, w.end_at AS endAt FROM pickup p JOIN chapter c ON c.id = p.chapter_id LEFT JOIN pickup_window w ON w.id = p.scheduled_window_id WHERE p.id = ?")
    .get(pickupId) as { chapterId: string; chapter: string; timezone: string; endAt: string | null } | undefined;
  if (!r) return;
  for (const id of coordinatorsOf(r.chapterId)) {
    send(id, "pickup_overdue", `Overdue pickup in ${r.chapter}`, `A pickup whose window ended ${r.endAt ? formatLocal(r.endAt, r.timezone) : "earlier"} has not been closed. Please check in with the assigned volunteers on the Pickups tab.`);
  }
}
export function notifyCoordinatorsAtRisk(requestId: string) {
  const r = getDb().prepare("SELECT chapter_id AS chapterId, needed_by AS neededBy, status FROM request WHERE id = ?").get(requestId) as { chapterId: string; neededBy: string; status: string } | undefined;
  if (!r) return;
  for (const id of coordinatorsOf(r.chapterId)) {
    send(id, "request_at_risk", "A request may miss its needed-by date", `${requestLabel(requestId)} is still ${r.status} and is needed by ${r.neededBy}. Open the Requests tab to fill it from stock or chase the claim.`);
  }
}
