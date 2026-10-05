import { freshDb, makeUser } from "./helpers";
import { setClock } from "@/lib/time";
import { setEmailProvider, type EmailMessage } from "@/lib/email";
import { getChapterBySlug } from "@/lib/services/access";
import { setMember } from "@/lib/services/chapters";
import { acknowledgeSafety } from "@/lib/services/safety";
import { listItems } from "@/lib/services/items";
import { createNeed } from "@/lib/services/needs";
import { createZone } from "@/lib/services/zones";
import { createPartner } from "@/lib/services/partners";
import { createPledge } from "@/lib/services/pledges";
import type { Actor } from "@/lib/types";

/** Monday 2 Nov 2026, 10:00 in Toronto (EST, UTC-5). Windows below are on Friday 6 Nov. */
export const NOW = new Date("2026-11-02T15:00:00Z");
export const FRIDAY = "2026-11-06";
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
  const donor = makeUser(db, "Donor");
  const donor2 = makeUser(db, "Donor Two");
  const stranger = makeUser(db, "Stranger");
  const email = (a: Actor) => `${a.name!.toLowerCase().replace(/\s+/g, ".")}@example.test`;
  setMember(admin, london.id, { email: email(lonCoord), role: "coordinator" });
  setMember(admin, oshawa.id, { email: email(oshCoord), role: "coordinator" });
  for (const v of [vol1, vol2, vol3, unackedVol]) setMember(lonCoord, london.id, { email: email(v), role: "volunteer" });
  setMember(oshCoord, oshawa.id, { email: email(oshVol), role: "volunteer" });
  for (const v of [vol1, vol2, vol3, oshVol]) acknowledgeSafety(v);
  const items = listItems();
  const item = (slug: string) => items.find((i) => i.slug === slug)!.id;
  const socksNeed = createNeed(lonCoord, london.id, { itemId: item("socks"), quantity: 20 });
  const toqueNeed = createNeed(lonCoord, london.id, { itemId: item("toque"), quantity: 10, priority: "high" });
  const zone = createZone(lonCoord, london.id, { name: "Western UCC front desk", description: "University Community Centre, main floor front desk", hours: "Mon–Fri 10:00–16:00" });
  const partner = createPartner(lonCoord, london.id, { name: "Downtown Shelter", description: "Emergency shelter" });
  sent.length = 0;

  const pickupPledge = (who: Actor = donor, over: Record<string, unknown> = {}) =>
    createPledge(who, {
      chapter: "london", method: "pickup", items: [{ needId: socksNeed.needId, quantity: 4 }, { needId: toqueNeed.needId, quantity: 2 }],
      address: ADDRESS, notes: NOTES, phone: PHONE, windows: [{ date: FRIDAY, start: "10:00", end: "12:00" }, { date: "2026-11-07", start: "13:00", end: "15:00" }], ...over,
    }).id;
  const dropoffPledge = (who: Actor = donor, over: Record<string, unknown> = {}) =>
    createPledge(who, { chapter: "london", method: "dropoff", items: [{ needId: socksNeed.needId, quantity: 6 }], zoneId: zone.id, expectedDate: "2026-11-05", ...over }).id;

  return { db, sent, london, oshawa, admin, lonCoord, oshCoord, vol1, vol2, vol3, unackedVol, oshVol, donor, donor2, stranger, item, socksNeed, toqueNeed, zone, partner, pickupPledge, dropoffPledge };
}
export type World = ReturnType<typeof world>;
