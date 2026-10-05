// Demo data. Used only by `npm run db:seed-demo` (which refuses to run in production). Everything goes through the
// real services; then a few timestamps and pickup windows are moved with SQL so every state can be shown today,
// including requests delivered days ago (so the impact page has a time-to-delivery to show).
import { getDb } from "./db";
import { addDays, localDate, zonedToUtc } from "./time";
import type { Actor } from "./types";
import { getChapterBySlug } from "./services/access";
import { setMember } from "./services/chapters";
import { acknowledgeSafety } from "./services/safety";
import { listItems } from "./services/items";
import { createZone } from "./services/zones";
import { applyPartner, createPartner, createSite, decideWorker, requestAccess } from "./services/partners";
import { createRequest, fillFromStock, saveFavourite } from "./services/requests";
import { cancelClaim, createClaim, getMyClaim, receiveClaim } from "./services/claims";
import { assembleKits, createKitTemplate, listKitTemplates, updateKitTemplate } from "./services/kits";
import { adjustStock } from "./services/stock";
import { setTarget } from "./services/restock";
import { assignDeliveryVolunteer, completeDelivery, confirmReceipt, createDelivery, startDelivery } from "./services/deliveries";
import { createPeriod, createSlot, signUpShift, weekdayOf } from "./services/shifts";
import { arrive, assignVolunteer, completePickup, confirmWindow } from "./services/pickups";
import { fileConcern } from "./services/concerns";

export type DemoUsers = {
  admin: Actor; londonCoordinator: Actor; oshawaCoordinator: Actor;
  londonVolunteers: Actor[]; // [0..2] acknowledged the Safety rules
  newVolunteer: Actor; // a volunteer who has not yet acknowledged them
  oshawaVolunteers: Actor[];
  neighbours: Actor[]; // six neighbours; [0..2] also claim in Oshawa
  londonWorker: Actor; // approved agency worker, Ark Aid Street Mission (demo)
  londonWorker2: Actor; // approved agency worker, Downtown Outreach (demo)
  pendingWorker: Actor; // asked to join Ark Aid, waiting for a coordinator
  applicant: Actor; // applied for a new partner, waiting for a coordinator
  oshawaWorker: Actor;
};
export const DEMO_EMAIL = (a: Actor) => `${a.name!.toLowerCase().replace(/\s+/g, "-")}@example.test`;

const email = (a: Actor) => (getDb().prepare('SELECT email FROM "user" WHERE id = ?').get(a.id) as { email: string }).email;

/** Moves a pickup's first window to `dayOffset` days from today so each pickup state can be shown now. */
function moveWindow(pickupId: string, tz: string, dayOffset: number, start: string, end: string) {
  const db = getDb();
  const first = db.prepare("SELECT id FROM pickup_window WHERE pickup_id = ? ORDER BY start_at LIMIT 1").get(pickupId) as { id: string };
  db.prepare("DELETE FROM pickup_window WHERE pickup_id = ? AND id <> ?").run(pickupId, first.id);
  const date = addDays(localDate(tz), dayOffset);
  db.prepare("UPDATE pickup_window SET date = ?, start_time = ?, end_time = ?, start_at = ?, end_at = ? WHERE id = ?").run(
    date, start, end, zonedToUtc(date, start, tz).toISOString(), zonedToUtc(date, end, tz).toISOString(), first.id,
  );
  db.prepare("UPDATE pickup SET scheduled_window_id = ? WHERE id = ?").run(first.id, pickupId);
  return zonedToUtc(date, start, tz);
}

/** Backdates a request (and its delivery) so it reads as delivered `deliveredHoursAgo` after being asked `askedHoursAgo` ago. */
function backdate(requestId: string, askedHoursAgo: number, deliveredHoursAgo: number, confirmed: boolean) {
  const db = getDb();
  const iso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  db.prepare("UPDATE request SET created_at = ?, delivered_at = ?, confirmed_at = ? WHERE id = ?").run(iso(askedHoursAgo), iso(deliveredHoursAgo), confirmed ? iso(deliveredHoursAgo - 2) : null, requestId);
  db.prepare("UPDATE delivery SET started_at = ?, completed_at = ? WHERE id IN (SELECT delivery_id FROM delivery_request WHERE request_id = ?)").run(iso(deliveredHoursAgo + 1.5), iso(deliveredHoursAgo), requestId);
}

const nextWeekday = (tz: string, weekday: number, weeksAhead = 0) => {
  let d = addDays(localDate(tz), 1);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return addDays(d, 7 * weeksAhead);
};

export function seedDemoData(u: DemoUsers) {
  const london = getChapterBySlug("london");
  const oshawa = getChapterBySlug("oshawa");
  const items = listItems();
  const item = (slug: string) => items.find((i) => i.slug === slug)!.id;
  const tz = london.timezone;
  const lc = u.londonCoordinator, oc = u.oshawaCoordinator;

  // People and roles.
  setMember(u.admin, london.id, { email: email(lc), role: "coordinator" });
  setMember(u.admin, oshawa.id, { email: email(oc), role: "coordinator" });
  for (const v of [...u.londonVolunteers, u.newVolunteer]) setMember(lc, london.id, { email: email(v), role: "volunteer" });
  for (const v of u.oshawaVolunteers) setMember(oc, oshawa.id, { email: email(v), role: "volunteer" });
  for (const v of [...u.londonVolunteers, ...u.oshawaVolunteers]) acknowledgeSafety(v);

  // Zones, partners with delivery sites, workers.
  const zones = [
    createZone(lc, london.id, { name: "Student centre front desk (demo)", description: "Main floor front desk, University Community Centre", hours: "Mon–Fri 10:00–16:00" }),
    createZone(lc, london.id, { name: "Library main lobby (demo)", description: "Main floor lobby, next to the information desk", hours: "Mon–Thu 9:00–20:00" }),
  ];
  const oZone = createZone(oc, oshawa.id, { name: "Student life office (demo)", description: "Student life office, main campus building", hours: "Mon–Fri 10:00–15:00" });
  createZone(oc, oshawa.id, { name: "Library lobby (demo)", description: "Front lobby of the campus library", hours: "Mon–Fri 9:00–18:00" });
  const ark = createPartner(lc, london.id, { name: "Ark Aid Street Mission (demo)", description: "Street mission and drop-in", excludedItems: "Used underwear, glass items" });
  const arkSite = createSite(lc, ark.id, { name: "Ark Aid main building (demo)", address: "696 Dundas St", receivingHours: "Mon–Fri 9:00–16:00" });
  const down = createPartner(lc, london.id, { name: "Downtown Outreach (demo)", description: "Street outreach team" });
  const downSite = createSite(lc, down.id, { name: "Outreach hub (demo)", address: "1 King St", receivingHours: "Daily 10:00–14:00" });
  const harbour = createPartner(oc, oshawa.id, { name: "Harbour Outreach (demo)", description: "Street outreach team", excludedItems: "Anything second-hand except coats" });
  const harbourSite = createSite(oc, harbour.id, { name: "Harbour drop-in (demo)", address: "5 Simcoe St", receivingHours: "Daily 9:00–17:00" });
  const oShelter = createPartner(oc, oshawa.id, { name: "Lakeside Shelter (demo)", description: "Emergency shelter" });
  createSite(oc, oShelter.id, { name: "Lakeside main entrance (demo)", address: "20 Lake Rd", receivingHours: "Mon–Fri 10:00–16:00" });
  for (const [w, p, c] of [[u.londonWorker, ark, lc], [u.londonWorker2, down, lc], [u.oshawaWorker, harbour, oc]] as const) {
    requestAccess(w, p.id);
    decideWorker(c, p.id, w.id, { decision: "approved" });
  }
  requestAccess(u.pendingWorker, ark.id); // waiting for a coordinator
  applyPartner(u.applicant, { chapter: "london", name: "Eastside Food Bank (demo)", description: "Applied to become a partner" }); // waiting for verification

  // Kit templates, stock and restock targets.
  for (const [ch, coord] of [[london, lc], [oshawa, oc]] as const) {
    const t = listKitTemplates(ch.id).find((x) => x.name === "Winter outreach kit")!;
    updateKitTemplate(coord, t.id, { active: true });
  }
  const kit = listKitTemplates(london.id).find((x) => x.name === "Winter outreach kit")!;
  const stock: [string, number][] = [["socks", 40], ["toque", 20], ["gloves", 20], ["toothbrush", 20], ["toothpaste", 20], ["soap-bar", 20], ["hand-warmers", 40], ["granola-bar", 40], ["lip-balm", 20], ["drawstring-bag", 10]];
  for (const [slug, n] of stock) adjustStock(lc, london.id, { kind: "adjusted", itemId: item(slug), size: "", delta: n, note: "Opening count (demo)" });
  for (const [slug, n] of [["scarf", 10], ["gloves", 12], ["toque", 10], ["bandages", 8]] as [string, number][]) {
    adjustStock(oc, oshawa.id, { kind: "adjusted", itemId: item(slug), size: "", delta: n, note: "Opening count (demo)" });
  }
  createKitTemplate(lc, london.id, { name: "Hygiene kit (demo)", description: "Toothbrush, toothpaste, soap, lip balm", active: true, items: ["toothbrush", "toothpaste", "soap-bar", "lip-balm"].map((s) => ({ itemId: item(s), size: "", quantity: 1 })) });
  setTarget(lc, london.id, { itemId: item("socks"), size: "", target: 60 }); // below target: a restock request appears on the board
  setTarget(lc, london.id, { itemId: item("toothbrush"), size: "", target: 10 });
  setTarget(oc, oshawa.id, { itemId: item("scarf"), size: "", target: 20 });

  // Shifts and exam-period planning.
  const slots = [
    createSlot(lc, london.id, { label: "Tuesday evening run", weekday: 1, start: "17:00", end: "19:00", needed: 2 }),
    createSlot(lc, london.id, { label: "Saturday morning run", weekday: 5, start: "10:00", end: "12:00", needed: 3 }),
  ];
  const oSlot = createSlot(oc, oshawa.id, { label: "Wednesday evening run", weekday: 2, start: "17:00", end: "19:00", needed: 2 });
  const [v1, v2, v3] = u.londonVolunteers;
  signUpShift(v1, slots[0].id, { date: nextWeekday(tz, 1) });
  signUpShift(v2, slots[0].id, { date: nextWeekday(tz, 1) });
  signUpShift(v1, slots[1].id, { date: nextWeekday(tz, 5) });
  signUpShift(v3, slots[1].id, { date: nextWeekday(tz, 5, 1) });
  signUpShift(u.oshawaVolunteers[0], oSlot.id, { date: nextWeekday(oshawa.timezone, 2) });
  createPeriod(lc, london.id, { label: "Winter exams (demo)", startDate: addDays(localDate(tz), 14), endDate: addDays(localDate(tz), 28), extraNeeded: 1 });

  const ahead = (n: number) => addDays(localDate(tz), n);
  const post = (who: Actor, partnerId: string, siteId: string, slug: string, size: string, quantity: number, days: number, extra: Record<string, unknown> = {}) =>
    createRequest(who, { type: "item", partnerId, siteId, itemId: item(slug), size, quantity, neededBy: ahead(days), ...extra }).id;
  const w1 = u.londonWorker, w2 = u.londonWorker2;
  saveFavourite(w1, ark.id, { itemId: item("mens-winter-boots"), size: "11", quantity: 6, siteId: arkSite.id, urgency: "normal" });

  // Delivered history (backdated), so Impact has a median time to delivery.
  const h1 = post(w1, ark.id, arkSite.id, "toothbrush", "", 6, 5);
  fillFromStock(lc, h1);
  const d1 = createDelivery(lc, london.id, { siteId: arkSite.id, requestIds: [h1], plannedFor: ahead(0) }).id;
  assignDeliveryVolunteer(lc, d1, { volunteerId: v1.id }); assignDeliveryVolunteer(lc, d1, { volunteerId: v2.id });
  startDelivery(v1, d1); completeDelivery(v1, d1); confirmReceipt(w1, h1);
  backdate(h1, 60, 14, true);
  const h2 = post(w1, ark.id, arkSite.id, "hand-warmers", "", 8, 5);
  fillFromStock(lc, h2);
  const d2 = createDelivery(lc, london.id, { siteId: arkSite.id, requestIds: [h2], plannedFor: ahead(0) }).id;
  assignDeliveryVolunteer(lc, d2, { volunteerId: v3.id }); assignDeliveryVolunteer(lc, d2, { volunteerId: v1.id });
  startDelivery(v3, d2); completeDelivery(v3, d2); confirmReceipt(w1, h2);
  backdate(h2, 120, 100, true);
  // Claimed by a neighbour, dropped off, delivered, waiting for the agency to confirm.
  const [n1, n2, n3, n4, n5, n6] = u.neighbours;
  const h3 = post(w1, ark.id, arkSite.id, "socks", "", 6, 6);
  const h3c = createClaim(n2, { requestId: h3, quantity: 6, method: "dropoff", zoneId: zones[0].id, expectedDate: ahead(0) }).id;
  receiveClaim(lc, h3c, { quantity: 6 });
  const d3 = createDelivery(lc, london.id, { siteId: arkSite.id, requestIds: [h3], plannedFor: ahead(0) }).id;
  assignDeliveryVolunteer(lc, d3, { volunteerId: v2.id }); assignDeliveryVolunteer(lc, d3, { volunteerId: v3.id });
  startDelivery(v2, d3); completeDelivery(v2, d3);
  backdate(h3, 80, 30, false);

  // Open requests on the board and claims in every state (London).
  post(w1, ark.id, arkSite.id, "mens-winter-boots", "11", 6, 2, { urgency: "urgent", note: "Needed for outreach this week" }); // open, urgent
  post(w1, ark.id, arkSite.id, "toothbrush", "", 5, 1, { urgency: "urgent" }); // open; the shelf can fill it
  const sweat = post(w2, down.id, downSite.id, "sweatshirt", "L", 4, 5);
  createClaim(n2, { requestId: sweat, quantity: 1, method: "dropoff", zoneId: zones[1].id, expectedDate: ahead(2) }); // partial claim: 3 still needed
  const windows = (days: number) => [{ date: ahead(days), start: "10:00", end: "12:00" }, { date: ahead(days + 1), start: "13:00", end: "16:00" }];
  const pickup = (who: Actor, requestId: string, qty: number, days: number) =>
    createClaim(who, { requestId, quantity: qty, method: "pickup", address: `${100 + qty} Demo Street, Unit ${qty}`, notes: "Demo notes: ring the bell", phone: "", windows: windows(days) }).id;
  const pk = (who: Actor, claimId: string) => getMyClaim(who, claimId).pickup!;
  const confirm = (who: Actor, claimId: string) => { const p = pk(who, claimId); confirmWindow(lc, p.id, { windowId: p.windows[0].id }); };
  const twoVols = (who: Actor, claimId: string, a: Actor, b: Actor) => { assignVolunteer(lc, pk(who, claimId).id, { volunteerId: a.id }); assignVolunteer(lc, pk(who, claimId).id, { volunteerId: b.id }); confirm(who, claimId); };

  pickup(n1, post(w1, ark.id, arkSite.id, "toque", "", 10, 4), 3, 3); // claimed, nobody assigned yet
  const r4 = post(w2, down.id, downSite.id, "gloves", "", 6, 4);
  const c4 = pickup(n2, r4, 2, 3);
  assignVolunteer(lc, pk(n2, c4).id, { volunteerId: v1.id }); // one volunteer so far
  const c5 = pickup(n3, post(w1, ark.id, arkSite.id, "sweatpants", "M", 6, 6), 6, 3);
  twoVols(n3, c5, v1, v2); // scheduled, in the future
  const c6 = pickup(n4, post(w2, down.id, downSite.id, "backpack", "", 3, 5), 3, 3);
  twoVols(n4, c6, v1, v2);
  moveWindow(pk(n4, c6).id, tz, 0, "09:00", "20:00"); // today: address visible, check-in open
  const c7 = pickup(n5, post(w1, ark.id, arkSite.id, "drawstring-bag", "", 4, 4), 4, 3);
  twoVols(n5, c7, v2, v3);
  moveWindow(pk(n5, c7).id, tz, -1, "10:00", "12:00"); // overdue: window ended yesterday, still open
  const c8 = pickup(n6, post(w2, down.id, downSite.id, "power-bank", "", 2, 4), 2, 3);
  twoVols(n6, c8, v2, v3);
  const s8 = moveWindow(pk(n6, c8).id, tz, -2, "10:00", "12:00");
  for (const v of [v2, v3]) arrive(v, pk(n6, c8).id, s8);
  for (const v of [v2, v3]) completePickup(v, pk(n6, c8).id, { outcome: "collected" }, s8); // collected, waiting to be counted
  const r9 = post(w1, ark.id, arkSite.id, "sleeping-bag", "", 2, 5);
  const c9 = pickup(n1, r9, 2, 3);
  twoVols(n1, c9, v1, v3);
  const s9 = moveWindow(pk(n1, c9).id, tz, -3, "13:00", "15:00");
  for (const v of [v1, v3]) arrive(v, pk(n1, c9).id, s9);
  for (const v of [v1, v3]) completePickup(v, pk(n1, c9).id, { outcome: "collected" }, s9);
  receiveClaim(lc, c9, { quantity: 2 }); // received: the request is now in hand, ready for a delivery run
  cancelClaim(n2, pickup(n2, post(w1, ark.id, arkSite.id, "running-shoes", "10", 1, 5), 1, 4)); // cancelled by the neighbour: back on the board
  const r11 = post(w1, ark.id, arkSite.id, "pants-numeric", "12", 2, 6);
  const c11 = pickup(n3, r11, 2, 3);
  twoVols(n3, c11, v1, v3);
  const s11 = moveWindow(pk(n3, c11).id, tz, -3, "10:00", "12:00");
  for (const v of [v1, v3]) arrive(v, pk(n3, c11).id, s11);
  completePickup(v1, pk(n3, c11).id, { outcome: "could_not_complete", reason: "nobody_home" }, s11); // no-show
  fileConcern(n3, { claimId: c11, category: "no_show", details: "Demo: I was out when the volunteers arrived; can we reschedule?" });
  // Kits: two assembled and filled from stock, planned on a delivery to Downtown Outreach.
  const kitReq = createRequest(w2, { type: "kit", partnerId: down.id, siteId: downSite.id, kitTemplateId: kit.id, quantity: 2, neededBy: ahead(3), urgency: "normal" }).id;
  assembleKits(lc, london.id, { templateId: kit.id, count: 2 });
  fillFromStock(lc, kitReq);
  const d4 = createDelivery(lc, london.id, { siteId: downSite.id, requestIds: [kitReq], plannedFor: ahead(1) }).id;
  assignDeliveryVolunteer(lc, d4, { volunteerId: v1.id });
  // A request nobody claimed in time.
  const lapsed = post(w2, down.id, downSite.id, "scarf", "", 2, 1);
  getDb().prepare("UPDATE request SET status = 'expired', status_reason = 'Not filled by the needed-by date (demo)' WHERE id = ?").run(lapsed);

  // A drop-off waiting at a zone and a count already made.
  pickupless(n4, post(w2, down.id, downSite.id, "lip-balm", "", 4, 5), zones[0].id, ahead(1), 4);

  // Oshawa: a scheduled pickup, an unassigned one, a drop-off, one delivered request.
  const [o1, o2] = u.oshawaVolunteers;
  const ow = u.oshawaWorker;
  const oPost = (slug: string, size: string, qty: number, days: number, extra: Record<string, unknown> = {}) =>
    createRequest(ow, { type: "item", partnerId: harbour.id, siteId: harbourSite.id, itemId: item(slug), size, quantity: qty, neededBy: addDays(localDate(oshawa.timezone), days), ...extra }).id;
  oPost("scarf", "", 12, 2, { urgency: "urgent", note: "Cold snap this week" });
  const oReq = oPost("toque", "", 8, 5);
  const oWindows = (days: number) => [{ date: addDays(localDate(oshawa.timezone), days), start: "11:00", end: "13:00" }];
  const oc1 = createClaim(n1, { requestId: oReq, quantity: 2, method: "pickup", address: "201 Sample Avenue", notes: "", phone: "", windows: oWindows(2) }).id;
  const op = getMyClaim(n1, oc1).pickup!;
  assignVolunteer(oc, op.id, { volunteerId: o1.id });
  assignVolunteer(oc, op.id, { volunteerId: o2.id });
  confirmWindow(oc, op.id, { windowId: op.windows[0].id });
  createClaim(n2, { requestId: oReq, quantity: 3, method: "pickup", address: "203 Sample Avenue", notes: "", phone: "", windows: oWindows(3) });
  createClaim(n3, { requestId: oPost("bandages", "", 6, 4), quantity: 4, method: "dropoff", zoneId: oZone.id, expectedDate: addDays(localDate(oshawa.timezone), 1) });
  const oh = oPost("gloves", "", 6, 5);
  fillFromStock(oc, oh);
  const od = createDelivery(oc, oshawa.id, { siteId: harbourSite.id, requestIds: [oh], plannedFor: addDays(localDate(oshawa.timezone), 0) }).id;
  assignDeliveryVolunteer(oc, od, { volunteerId: o1.id }); assignDeliveryVolunteer(oc, od, { volunteerId: o2.id });
  startDelivery(o1, od); completeDelivery(o1, od); confirmReceipt(ow, oh);
  backdate(oh, 40, 20, true);
  signUpShift(o2, oSlot.id, { date: nextWeekday(oshawa.timezone, 2, 1) });

  function pickupless(who: Actor, requestId: string, zoneId: string, date: string, qty: number) {
    const c = createClaim(who, { requestId, quantity: qty, method: "dropoff", zoneId, expectedDate: date }).id;
    return c;
  }
}
