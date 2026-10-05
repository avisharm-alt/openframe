import { getDb } from "../db";
import { config } from "../config";
import { queueEmail } from "../email";
import { formatLocal, formatTime } from "../time";

// Plain-text emails. They never contain a pickup address, phone number or access note.

const emailOf = (userId: string | null): string | null => {
  if (!userId) return null;
  const r = getDb().prepare('SELECT email FROM "user" WHERE id = ?').get(userId) as { email: string } | undefined;
  return r?.email ?? null;
};
const send = (userId: string | null, template: string, subject: string, text: string) => {
  const to = emailOf(userId);
  if (to) queueEmail({ to, template, subject, text: `${text}\n\n— OpenFrame\n${config.baseUrl}`, });
};

type PledgeCtx = { donorId: string | null; method: string; chapter: string; timezone: string; summary: string; expectedDate: string | null; zone: string | null; pickupId: string | null };
function pledgeCtx(pledgeId: string): PledgeCtx | null {
  const db = getDb();
  const p = db
    .prepare(
      `SELECT p.donor_id AS donorId, p.method, p.expected_date AS expectedDate, c.name AS chapter, c.timezone, z.name AS zone, pk.id AS pickupId
         FROM pledge p JOIN chapter c ON c.id = p.chapter_id LEFT JOIN zone z ON z.id = p.zone_id LEFT JOIN pickup pk ON pk.pledge_id = p.id WHERE p.id = ?`,
    )
    .get(pledgeId) as Omit<PledgeCtx, "summary"> | undefined;
  if (!p) return null;
  const lines = db
    .prepare("SELECT pi.quantity, i.name FROM pledge_item pi JOIN item i ON i.id = pi.item_id WHERE pi.pledge_id = ? AND pi.quantity > 0 ORDER BY i.name")
    .all(pledgeId) as { quantity: number; name: string }[];
  return { ...p, summary: lines.map((l) => `${l.quantity} × ${l.name}`).join(", ") };
}

function chosenWindow(pickupId: string): { startAt: string; endAt: string } | null {
  const r = getDb()
    .prepare("SELECT w.start_at AS startAt, w.end_at AS endAt FROM pickup p JOIN pickup_window w ON w.id = p.scheduled_window_id WHERE p.id = ?")
    .get(pickupId) as { startAt: string; endAt: string } | undefined;
  return r ?? null;
}

export function notifyPledgeConfirmed(pledgeId: string) {
  const c = pledgeCtx(pledgeId);
  if (!c) return;
  const how = c.method === "dropoff" ? `You chose to drop off at ${c.zone} on ${c.expectedDate}.` : "You chose a pickup. Two volunteers will be assigned and we will email you the confirmed window.";
  send(c.donorId, "pledge_confirmed", `Thank you: your pledge to ${c.chapter} is confirmed`, `We have your pledge: ${c.summary}.\n${how}\nYou can see or change it any time under My pledges.`);
}

export function notifyPickupScheduled(pledgeId: string) {
  const c = pledgeCtx(pledgeId);
  if (!c || !c.pickupId) return;
  const w = chosenWindow(c.pickupId);
  if (!w) return;
  send(
    c.donorId, "pickup_scheduled", "Your pickup is scheduled",
    `Your pickup of ${c.summary} is scheduled for ${formatLocal(w.startAt, c.timezone)} to ${formatTime(w.endAt, c.timezone)}.\n` +
      "Two volunteers will come together, in daytime. Please hand the items over at the door: they will not come inside. Their arrival is shown on your My pledges page.",
  );
}

export function notifyCollected(pledgeId: string) {
  const c = pledgeCtx(pledgeId);
  if (!c) return;
  send(c.donorId, "pledge_collected", "Your items were collected", `The volunteers collected ${c.summary}. Thank you! We will count them into the stock shortly.`);
}

export function notifyThankYou(pledgeId: string, received: number) {
  const c = pledgeCtx(pledgeId);
  if (!c) return;
  const db = getDb();
  const ch = db.prepare("SELECT chapter_id AS id FROM pledge WHERE id = ?").get(pledgeId) as { id: string };
  const packages = (db.prepare("SELECT COUNT(*) AS n FROM package WHERE chapter_id = ? AND status = 'handed_off'").get(ch.id) as { n: number }).n;
  const items = (db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM inventory_ledger WHERE chapter_id = ? AND kind = 'received'").get(ch.id) as { n: number }).n;
  send(
    c.donorId, "thank_you", `Thank you from ${c.chapter}`,
    `We counted ${received} item${received === 1 ? "" : "s"} from your pledge into stock. They will go into care packages handed to people through our partner agencies.\n` +
      `So far ${c.chapter} has received ${items} items and handed off ${packages} package${packages === 1 ? "" : "s"}. You are part of that.`,
  );
}

export function notifyVolunteerAssigned(pickupId: string, volunteerId: string) {
  const r = getDb().prepare("SELECT p.pledge_id AS pledgeId FROM pickup p WHERE p.id = ?").get(pickupId) as { pledgeId: string } | undefined;
  if (!r) return;
  send(volunteerId, "volunteer_assigned", "You have a new pickup assignment", "A coordinator assigned you to a pickup. Open My pickups to see the window and your partner. The address is shown there starting 24 hours before the window. Remember: pairs only, daytime, doorstep handoff.");
}

export function notifyCoordinatorsOverdue(pickupId: string) {
  const db = getDb();
  const r = db
    .prepare("SELECT p.chapter_id AS chapterId, c.name AS chapter, c.timezone, w.end_at AS endAt FROM pickup p JOIN chapter c ON c.id = p.chapter_id LEFT JOIN pickup_window w ON w.id = p.scheduled_window_id WHERE p.id = ?")
    .get(pickupId) as { chapterId: string; chapter: string; timezone: string; endAt: string | null } | undefined;
  if (!r) return;
  const coordinators = db.prepare("SELECT user_id AS id FROM chapter_member WHERE chapter_id = ? AND role = 'coordinator'").all(r.chapterId) as { id: string }[];
  for (const c of coordinators) {
    send(c.id, "pickup_overdue", `Overdue pickup in ${r.chapter}`, `A pickup whose window ended ${r.endAt ? formatLocal(r.endAt, r.timezone) : "earlier"} has not been closed. Please check in with the assigned volunteers on the Pickups tab.`);
  }
}
