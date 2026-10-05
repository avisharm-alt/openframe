// Demo data. Used only by `npm run db:seed-demo` (which refuses to run in production). Everything goes through the
// real services, then a few pickup windows are moved in time with SQL so each pickup state can be shown today.
import { getDb } from "./db";
import { addDays, localDate, zonedToUtc } from "./time";
import type { Actor } from "./types";
import { getChapterBySlug } from "./services/access";
import { setMember } from "./services/chapters";
import { acknowledgeSafety } from "./services/safety";
import { listItems } from "./services/items";
import { createNeed } from "./services/needs";
import { updateTemplate, listTemplates } from "./services/templates";
import { createZone } from "./services/zones";
import { createPartner } from "./services/partners";
import { adjustStock } from "./services/inventory";
import { assemblePackages, handOffPackages } from "./services/packages";
import { cancelPledge, createPledge, getMyPledge, receivePledge } from "./services/pledges";
import { arrive, assignVolunteer, completePickup, confirmWindow } from "./services/pickups";
import { fileConcern } from "./services/concerns";

export type DemoUsers = {
  admin: Actor; londonCoordinator: Actor; oshawaCoordinator: Actor;
  londonVolunteers: Actor[]; // [0..2] acknowledged the Safety rules
  newVolunteer: Actor; // a volunteer who has not yet acknowledged them
  oshawaVolunteers: Actor[];
  donors: Actor[]; // six donors for London, [0] also pledges in Oshawa
};
export const DEMO_EMAIL = (a: Actor) => `${a.name!.toLowerCase().replace(/\s+/g, "-")}@example.test`;

const email = (a: Actor) => (getDb().prepare('SELECT email FROM "user" WHERE id = ?').get(a.id) as { email: string }).email;

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

export function seedDemoData(u: DemoUsers) {
  const london = getChapterBySlug("london");
  const oshawa = getChapterBySlug("oshawa");
  const items = listItems();
  const item = (slug: string) => items.find((i) => i.slug === slug)!.id;

  // People and roles.
  setMember(u.admin, london.id, { email: email(u.londonCoordinator), role: "coordinator" });
  setMember(u.admin, oshawa.id, { email: email(u.oshawaCoordinator), role: "coordinator" });
  for (const v of [...u.londonVolunteers, u.newVolunteer]) setMember(u.londonCoordinator, london.id, { email: email(v), role: "volunteer" });
  for (const v of u.oshawaVolunteers) setMember(u.oshawaCoordinator, oshawa.id, { email: email(v), role: "volunteer" });
  for (const v of [...u.londonVolunteers, ...u.oshawaVolunteers]) acknowledgeSafety(v);

  // Zones, partners, templates, needs for both chapters.
  const lc = u.londonCoordinator, oc = u.oshawaCoordinator;
  createZone(lc, london.id, { name: "Student centre front desk (demo)", description: "Main floor front desk, University Community Centre", hours: "Mon–Fri 10:00–16:00" });
  createZone(lc, london.id, { name: "Library main lobby (demo)", description: "Main floor lobby, next to the information desk", hours: "Mon–Thu 9:00–20:00" });
  createZone(oc, oshawa.id, { name: "Student life office (demo)", description: "Student life office, main campus building", hours: "Mon–Fri 10:00–15:00" });
  createZone(oc, oshawa.id, { name: "Library lobby (demo)", description: "Front lobby of the campus library", hours: "Mon–Fri 9:00–18:00" });
  const shelter = createPartner(lc, london.id, { name: "Downtown Shelter (demo)", description: "Emergency shelter and drop-in" });
  createPartner(lc, london.id, { name: "Community Meal Program (demo)", description: "Weekday meals", acceptsPackages: false });
  const oShelter = createPartner(oc, oshawa.id, { name: "Harbour Outreach (demo)", description: "Street outreach team" });
  for (const [ch, coord, target] of [[london, lc, 10], [oshawa, oc, 5]] as const) {
    const t = listTemplates(ch.id).find((x) => x.name === "Winter kit")!;
    updateTemplate(coord, t.id, { active: true, weeklyTarget: target });
  }
  const pads = createNeed(lc, london.id, { itemId: item("pads"), quantity: 30, priority: "high", note: "Running low" });
  createNeed(lc, london.id, { itemId: item("tampons"), quantity: 24, priority: "normal" });
  createNeed(lc, london.id, { itemId: item("winter-coat"), quantity: 10, priority: "high", note: "Adult sizes M to XL, clean and in good condition" });
  createNeed(oc, oshawa.id, { itemId: item("scarf"), quantity: 25, priority: "urgent", note: "Cold snap this week" });
  createNeed(oc, oshawa.id, { itemId: item("bandages"), quantity: 15 });

  // Stock, packages and hand-offs (so the impact page has something to show).
  const stock: [string, number][] = [["socks", 14], ["toque", 8], ["gloves", 9], ["toothbrush", 12], ["toothpaste", 10], ["soap-bar", 11], ["hand-warmers", 20], ["granola-bar", 24], ["lip-balm", 6]];
  for (const [slug, n] of stock) adjustStock(lc, london.id, { kind: "adjusted", itemId: item(slug), delta: n, note: "Opening count (demo)" });
  const kit = listTemplates(london.id).find((x) => x.name === "Winter kit")!;
  const made = assemblePackages(lc, london.id, { templateId: kit.id, count: 4 }).packageIds;
  const tz = london.timezone;
  handOffPackages(lc, london.id, { packageIds: made.slice(0, 2), agencyId: shelter.id, date: addDays(localDate(tz), -9) });
  handOffPackages(lc, london.id, { packageIds: made.slice(2, 3), agencyId: shelter.id, date: addDays(localDate(tz), -2) });
  for (const [slug, n] of [["socks", 6], ["toque", 3], ["gloves", 3], ["toothbrush", 3], ["toothpaste", 3], ["soap-bar", 3], ["hand-warmers", 6], ["granola-bar", 6], ["lip-balm", 3]] as [string, number][]) {
    adjustStock(oc, oshawa.id, { kind: "adjusted", itemId: item(slug), delta: n, note: "Opening count (demo)" });
  }
  const oKit = listTemplates(oshawa.id).find((x) => x.name === "Winter kit")!;
  handOffPackages(oc, oshawa.id, { packageIds: assemblePackages(oc, oshawa.id, { templateId: oKit.id, count: 2 }).packageIds, agencyId: oShelter.id, date: addDays(localDate(oshawa.timezone), -1) });

  // Pickups in every state.
  const [v1, v2, v3] = u.londonVolunteers;
  const [d1, d2, d3, d4, d5, d6] = u.donors;
  const ahead = (n: number) => addDays(localDate(tz), n);
  const lines = (n: number) => [{ needId: pads.needId, quantity: n }];
  const pickup = (donor: Actor, n: number, days: number) =>
    createPledge(donor, {
      chapter: "london", method: "pickup", items: lines(n), address: `${100 + n} Demo Street, Unit ${n}`, notes: "Demo notes: ring the bell", phone: "",
      windows: [{ date: ahead(days), start: "10:00", end: "12:00" }, { date: ahead(days + 1), start: "13:00", end: "16:00" }],
    }).id;
  const pk = (donor: Actor, id: string) => getMyPledge(donor, id).pickup!.id;
  const confirm = (donor: Actor, pledgeId: string) => {
    const p = getMyPledge(donor, pledgeId).pickup!;
    confirmWindow(lc, p.id, { windowId: p.windows[0].id });
  };

  // pledged, nobody assigned yet
  pickup(d1, 1, 4);
  // pledged, one volunteer so far
  const b = pickup(d2, 1, 5);
  assignVolunteer(lc, pk(d2, b), { volunteerId: v1.id });
  // scheduled (future)
  const c = pickup(d3, 2, 3);
  assignVolunteer(lc, pk(d3, c), { volunteerId: v1.id });
  assignVolunteer(lc, pk(d3, c), { volunteerId: v2.id });
  confirm(d3, c);
  // today (window moved to 9:00-20:00 today so the address is visible and check-in is open)
  const dToday = pickup(d4, 2, 3);
  assignVolunteer(lc, pk(d4, dToday), { volunteerId: v1.id });
  assignVolunteer(lc, pk(d4, dToday), { volunteerId: v2.id });
  confirm(d4, dToday);
  moveWindow(pk(d4, dToday), tz, 0, "09:00", "20:00");
  // overdue (window ended yesterday, still open)
  const e = pickup(d5, 1, 3);
  assignVolunteer(lc, pk(d5, e), { volunteerId: v2.id });
  assignVolunteer(lc, pk(d5, e), { volunteerId: v3.id });
  confirm(d5, e);
  moveWindow(pk(d5, e), tz, -1, "10:00", "12:00");
  // collected, waiting to be counted
  const f = pickup(d6, 2, 3);
  assignVolunteer(lc, pk(d6, f), { volunteerId: v2.id });
  assignVolunteer(lc, pk(d6, f), { volunteerId: v3.id });
  confirm(d6, f);
  const fStart = moveWindow(pk(d6, f), tz, -2, "10:00", "12:00");
  for (const v of [v2, v3]) arrive(v, pk(d6, f), fStart);
  for (const v of [v2, v3]) completePickup(v, pk(d6, f), { outcome: "collected" }, fStart);
  // received (counted into stock)
  const g = pickup(d1, 3, 3);
  assignVolunteer(lc, pk(d1, g), { volunteerId: v1.id });
  assignVolunteer(lc, pk(d1, g), { volunteerId: v3.id });
  confirm(d1, g);
  const gStart = moveWindow(pk(d1, g), tz, -4, "13:00", "15:00");
  for (const v of [v1, v3]) arrive(v, pk(d1, g), gStart);
  for (const v of [v1, v3]) completePickup(v, pk(d1, g), { outcome: "collected" }, gStart);
  receivePledge(lc, g, { lines: getMyPledge(d1, g).items.map((l) => ({ lineId: l.lineId, quantity: l.quantity })), note: "Demo" });
  // cancelled by the donor
  cancelPledge(d2, pickup(d2, 1, 6));
  // no-show: volunteers found nobody home
  const h = pickup(d3, 1, 3);
  assignVolunteer(lc, pk(d3, h), { volunteerId: v1.id });
  assignVolunteer(lc, pk(d3, h), { volunteerId: v3.id });
  confirm(d3, h);
  const hStart = moveWindow(pk(d3, h), tz, -3, "10:00", "12:00");
  for (const v of [v1, v3]) arrive(v, pk(d3, h), hStart);
  completePickup(v1, pk(d3, h), { outcome: "could_not_complete", reason: "nobody_home" }, hStart);
  fileConcern(d3, { pledgeId: h, category: "no_show", details: "Demo: I was out when the volunteers arrived; can we reschedule?" });

  // Drop-offs: one waiting at a zone, one already counted.
  const zones = getDb().prepare("SELECT id FROM zone WHERE chapter_id = ? ORDER BY name").all(london.id) as { id: string }[];
  createPledge(d4, { chapter: "london", method: "dropoff", items: [{ needId: pads.needId, quantity: 4 }], zoneId: zones[0].id, expectedDate: ahead(1) });
  const done = createPledge(d5, { chapter: "london", method: "dropoff", items: [{ needId: pads.needId, quantity: 5 }], zoneId: zones[1].id, expectedDate: ahead(0) }).id;
  receivePledge(lc, done, { lines: getMyPledge(d5, done).items.map((l) => ({ lineId: l.lineId, quantity: l.quantity })) });

  // Oshawa: a scheduled pickup, an unassigned one and a drop-off.
  const [o1, o2] = u.oshawaVolunteers;
  const scarf = getDb().prepare("SELECT id FROM need WHERE chapter_id = ? AND item_id = ? AND source = 'manual'").get(oshawa.id, item("scarf")) as { id: string };
  const oPickup = (donor: Actor, days: number, n: number) =>
    createPledge(donor, {
      chapter: "oshawa", method: "pickup", items: [{ needId: scarf.id, quantity: n }], address: `${200 + n} Sample Avenue`, notes: "", phone: "",
      windows: [{ date: addDays(localDate(oshawa.timezone), days), start: "11:00", end: "13:00" }],
    }).id;
  const os = oPickup(d1, 2, 2);
  const osPickup = getMyPledge(d1, os).pickup!;
  assignVolunteer(oc, osPickup.id, { volunteerId: o1.id });
  assignVolunteer(oc, osPickup.id, { volunteerId: o2.id });
  confirmWindow(oc, osPickup.id, { windowId: osPickup.windows[0].id });
  oPickup(d2, 3, 3);
  const oZone = getDb().prepare("SELECT id FROM zone WHERE chapter_id = ? ORDER BY name LIMIT 1").get(oshawa.id) as { id: string };
  createPledge(d3, { chapter: "oshawa", method: "dropoff", items: [{ needId: scarf.id, quantity: 4 }], zoneId: oZone.id, expectedDate: addDays(localDate(oshawa.timezone), 1) });
}
