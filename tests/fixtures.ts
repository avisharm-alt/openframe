import { freshDb, makeUser } from "./helpers";
import { setClock } from "@/lib/time";
import { setEmailProvider, type EmailMessage } from "@/lib/email";
import { getChapterBySlug } from "@/lib/services/access";
import { setMember } from "@/lib/services/chapters";
import { acknowledgeSafety } from "@/lib/services/safety";
import { listItems } from "@/lib/services/items";
import { createZone } from "@/lib/services/zones";
import { createPartner, createSite, decideWorker, requestAccess } from "@/lib/services/partners";
import { createRequest } from "@/lib/services/requests";
import { createClaim, getMyClaim } from "@/lib/services/claims";
import { appendLedger } from "@/lib/services/stock";
import type { Actor } from "@/lib/types";

/** Monday 2 Nov 2026, 10:00 in Toronto (EST, UTC-5). Windows below are on Friday 6 Nov. */
export const NOW = new Date("2026-11-02T15:00:00Z");
export const FRIDAY = "2026-11-06";
export const NEEDED_BY = "2026-11-10";
export const ADDRESS = "42 Wallaby Way, Unit 7";
export const NOTES = "Buzz 7B, leave via side gate";
export const PHONE = "519-555-0142";

export function world() {
  const db = freshDb();
  setClock(NOW);
  const sent: EmailMessage[] = [];
  setEmailProvider({ name: "test", send: async (m) => void sent.push(m) });
  const london = getChapterBySlug("london");
  const oshawa = getChapterBySlug("oshawa");
  const admin = makeUser(db, "Admin", "admin");
  const lonCoord = makeUser(db, "Lon Coord");
  const oshCoord = makeUser(db, "Osh Coord");
  const vol1 = makeUser(db, "Vol One");
  const vol2 = makeUser(db, "Vol Two");
  const vol3 = makeUser(db, "Vol Three");
  const unackedVol = makeUser(db, "Vol Unacked");
  const oshVol = makeUser(db, "Osh Vol");
  const neighbour = makeUser(db, "Neighbour");
  const neighbour2 = makeUser(db, "Neighbour Two");
  const stranger = makeUser(db, "Stranger");
  const worker = makeUser(db, "Ark Worker");
  const worker2 = makeUser(db, "Other Worker");
  const oshWorker = makeUser(db, "Osh Worker");
  const pending = makeUser(db, "Pending Worker");
  const email = (a: Actor) => `${a.name!.toLowerCase().replace(/\s+/g, ".")}@example.test`;
  setMember(admin, london.id, { email: email(lonCoord), role: "coordinator" });
  setMember(admin, oshawa.id, { email: email(oshCoord), role: "coordinator" });
  for (const v of [vol1, vol2, vol3, unackedVol]) setMember(lonCoord, london.id, { email: email(v), role: "volunteer" });
  setMember(oshCoord, oshawa.id, { email: email(oshVol), role: "volunteer" });
  for (const v of [vol1, vol2, vol3, oshVol]) acknowledgeSafety(v);

  const items = listItems();
  const item = (slug: string) => items.find((i) => i.slug === slug)!.id;
  const zone = createZone(lonCoord, london.id, { name: "Western UCC front desk", description: "University Community Centre, main floor front desk", hours: "Mon–Fri 10:00–16:00" });
  const ark = createPartner(lonCoord, london.id, { name: "Ark Aid Street Mission", description: "Street mission and drop-in", excludedItems: "Used underwear, glass items" });
  const arkSite = createSite(lonCoord, ark.id, { name: "Ark Aid main building", address: "696 Dundas St", receivingHours: "Mon–Fri 9:00–16:00" });
  const other = createPartner(lonCoord, london.id, { name: "Downtown Outreach", description: "Outreach team" });
  const otherSite = createSite(lonCoord, other.id, { name: "Outreach hub", address: "1 King St", receivingHours: "Daily 10–14" });
  const oshPartner = createPartner(oshCoord, oshawa.id, { name: "Harbour Outreach", description: "Outreach" });
  const oshSite = createSite(oshCoord, oshPartner.id, { name: "Harbour site", address: "5 Simcoe St", receivingHours: "Daily 9–17" });
  for (const [w, p, c] of [[worker, ark, lonCoord], [worker2, other, lonCoord], [oshWorker, oshPartner, oshCoord]] as const) {
    requestAccess(w, p.id);
    decideWorker(c, p.id, w.id, { decision: "approved" });
  }
  requestAccess(pending, ark.id); // asked for access, not approved yet
  sent.length = 0;

  /** A request from the Ark worker (default: 6 pairs of men's winter boots, size 11, needed by Tuesday 10 Nov). */
  const post = (over: Record<string, unknown> = {}, who: Actor = worker) =>
    createRequest(who, { type: "item", partnerId: ark.id, siteId: arkSite.id, itemId: item("mens-winter-boots"), size: "11", quantity: 6, neededBy: NEEDED_BY, ...over }).id;
  const windows = [{ date: FRIDAY, start: "10:00", end: "12:00" }, { date: "2026-11-07", start: "13:00", end: "15:00" }];
  const claimPickup = (who: Actor, requestId: string, over: Record<string, unknown> = {}) =>
    createClaim(who, { requestId, quantity: 2, method: "pickup", address: ADDRESS, notes: NOTES, phone: PHONE, windows, ...over }).id;
  const claimDropoff = (who: Actor, requestId: string, over: Record<string, unknown> = {}) =>
    createClaim(who, { requestId, quantity: 2, method: "dropoff", zoneId: zone.id, expectedDate: "2026-11-05", ...over }).id;
  const stock = (slug: string, n: number, size = "", chapterId = london.id) => appendLedger({ chapterId, itemId: item(slug), size, delta: n, kind: "adjusted" });
  const pickupOf = (who: Actor, claimId: string) => getMyClaim(who, claimId).pickup!;

  return { db, sent, london, oshawa, admin, lonCoord, oshCoord, vol1, vol2, vol3, unackedVol, oshVol, neighbour, neighbour2, stranger, worker, worker2, oshWorker, pending, item, zone, ark, arkSite, other, otherSite, oshPartner, oshSite, post, claimPickup, claimDropoff, stock, pickupOf, windows };
}
export type World = ReturnType<typeof world>;
