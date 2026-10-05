import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeUser } from "./helpers";
import { getChapterBySlug, isCoordinatorOf, isVolunteerOf } from "@/lib/services/access";
import { createChapter, listMembers, removeMember, setMember } from "@/lib/services/chapters";
import { createPartner, updatePartner } from "@/lib/services/partners";
import { createZone, updateZone } from "@/lib/services/zones";
import { createItem, listItems } from "@/lib/services/items";
import { adjustStock, listInventory, listLedger } from "@/lib/services/inventory";
import { createNeed, listNeeds, updateNeed } from "@/lib/services/needs";
import { assemblePackages, handOffPackages, listAssemblable, listPackages } from "@/lib/services/packages";
import { createTemplate, updateTemplate } from "@/lib/services/templates";
import type { Actor } from "@/lib/types";
import { ServiceError } from "@/lib/errors";

let london: ReturnType<typeof getChapterBySlug>;
let oshawa: ReturnType<typeof getChapterBySlug>;
let admin: Actor, lonCoord: Actor, oshCoord: Actor, lonVol: Actor, member: Actor;
let socks: string;

beforeEach(() => {
  const db = freshDb();
  london = getChapterBySlug("london");
  oshawa = getChapterBySlug("oshawa");
  admin = makeUser(db, "Admin", "admin");
  lonCoord = makeUser(db, "Lon Coord");
  oshCoord = makeUser(db, "Osh Coord");
  lonVol = makeUser(db, "Lon Vol");
  member = makeUser(db, "Plain Member");
  setMember(admin, london.id, { email: "lon.coord@example.test", role: "coordinator" });
  setMember(admin, oshawa.id, { email: "osh.coord@example.test", role: "coordinator" });
  setMember(lonCoord, london.id, { email: "lon.vol@example.test", role: "volunteer" });
  socks = listItems().find((i) => i.slug === "socks")!.id;
});

const forbidden = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).status).toBe(403);
    return;
  }
  throw new Error("expected a 403 but the call succeeded");
};

describe("chapter role scoping", () => {
  it("answers who coordinates and volunteers where", () => {
    expect(isCoordinatorOf(lonCoord, london.id)).toBe(true);
    expect(isCoordinatorOf(lonCoord, oshawa.id)).toBe(false);
    expect(isCoordinatorOf(admin, oshawa.id)).toBe(true);
    expect(isVolunteerOf(lonVol, london.id)).toBe(true);
    expect(isVolunteerOf(lonVol, oshawa.id)).toBe(false);
    expect(isCoordinatorOf(lonVol, london.id)).toBe(false);
    expect(isCoordinatorOf(member, london.id)).toBe(false);
  });

  it("a London coordinator cannot act on Oshawa (every coordinator action)", () => {
    const oshTemplate = createTemplate(oshCoord, oshawa.id, { name: "T", weeklyTarget: 1, items: [{ itemId: socks, quantity: 1 }] });
    const oshNeed = createNeed(oshCoord, oshawa.id, { itemId: socks, quantity: 3 });
    const oshZone = createZone(oshCoord, oshawa.id, { name: "Z", description: "Front desk" });
    const oshPartner = createPartner(oshCoord, oshawa.id, { name: "P" });
    const calls: [string, () => unknown][] = [
      ["list needs", () => listNeeds(lonCoord, oshawa.id)],
      ["create need", () => createNeed(lonCoord, oshawa.id, { itemId: socks, quantity: 1 })],
      ["update need", () => updateNeed(lonCoord, oshNeed.needId, { quantity: 5 })],
      ["create template", () => createTemplate(lonCoord, oshawa.id, { name: "X", weeklyTarget: 1, items: [{ itemId: socks, quantity: 1 }] })],
      ["update template", () => updateTemplate(lonCoord, oshTemplate.id, { weeklyTarget: 9 })],
      ["create zone", () => createZone(lonCoord, oshawa.id, { name: "Z2", description: "x" })],
      ["update zone", () => updateZone(lonCoord, oshZone.id, { active: false })],
      ["create partner", () => createPartner(lonCoord, oshawa.id, { name: "P2" })],
      ["update partner", () => updatePartner(lonCoord, oshPartner.id, { active: false })],
      ["view inventory", () => listInventory(lonCoord, oshawa.id)],
      ["view ledger", () => listLedger(lonCoord, oshawa.id)],
      ["adjust stock", () => adjustStock(lonCoord, oshawa.id, { kind: "adjusted", itemId: socks, delta: 1, note: "x" })],
      ["assemblable", () => listAssemblable(lonCoord, oshawa.id)],
      ["assemble", () => assemblePackages(lonCoord, oshawa.id, { templateId: oshTemplate.id, count: 1 })],
      ["list packages", () => listPackages(lonCoord, oshawa.id)],
      ["hand off", () => handOffPackages(lonCoord, oshawa.id, { packageIds: ["12345678"], agencyId: oshPartner.id, date: "2026-01-01" })],
      ["list members", () => listMembers(lonCoord, oshawa.id)],
      ["add volunteer", () => setMember(lonCoord, oshawa.id, { email: "lon.vol@example.test", role: "volunteer" })],
      ["remove member", () => removeMember(lonCoord, oshawa.id, oshCoord.id)],
    ];
    for (const [, fn] of calls) forbidden(fn);
  });

  it("the Oshawa coordinator's own chapter still works, and acting through the wrong chapter id on a London object fails", () => {
    expect(() => listNeeds(oshCoord, oshawa.id)).not.toThrow();
    const londonZone = createZone(lonCoord, london.id, { name: "UCC", description: "Front desk" });
    forbidden(() => updateZone(oshCoord, londonZone.id, { active: false }));
    const t = createTemplate(lonCoord, london.id, { name: "T", weeklyTarget: 1, items: [{ itemId: socks, quantity: 1 }] });
    // Passing the coordinator's own chapter id but a template from another chapter must not work either.
    expect(() => assemblePackages(oshCoord, oshawa.id, { templateId: t.id, count: 1 })).toThrowError(/not found/i);
  });

  it("members and volunteers have no coordinator powers anywhere", () => {
    for (const who of [member, lonVol]) {
      forbidden(() => listNeeds(who, london.id));
      forbidden(() => createNeed(who, london.id, { itemId: socks, quantity: 1 }));
      forbidden(() => listInventory(who, london.id));
      forbidden(() => setMember(who, london.id, { email: "plain.member@example.test", role: "volunteer" }));
      forbidden(() => createItem(who, { name: "Gift card", category: "other", unit: "each" }));
    }
  });

  it("only an admin appoints coordinators or creates chapters; coordinators manage volunteers", () => {
    forbidden(() => setMember(lonCoord, london.id, { email: "plain.member@example.test", role: "coordinator" }));
    forbidden(() => createChapter(lonCoord, { name: "Toronto (UofT)", city: "Toronto, ON", timezone: "America/Toronto" }));
    // A coordinator cannot demote or remove another coordinator either.
    setMember(admin, london.id, { email: "plain.member@example.test", role: "coordinator" });
    forbidden(() => setMember(lonCoord, london.id, { email: "plain.member@example.test", role: "volunteer" }));
    forbidden(() => removeMember(lonCoord, london.id, member.id));
    removeMember(lonCoord, london.id, lonVol.id);
    expect(isVolunteerOf(lonVol, london.id)).toBe(false);
    expect(listMembers(admin, london.id).map((m) => m.role).sort()).toEqual(["coordinator", "coordinator"]);
  });

  it("looks people up by exact email only and tells the coordinator when there is no account", () => {
    expect(() => setMember(lonCoord, london.id, { email: "nobody@example.test", role: "volunteer" })).toThrowError(/No account with that email/);
  });

  it("admins can create a chapter from data alone", () => {
    const c = createChapter(admin, { name: "Toronto (UofT)", city: "Toronto, ON", timezone: "America/Toronto" });
    expect(c.slug).toBe("toronto");
    expect(() => createChapter(admin, { name: "Again", city: "Toronto, ON", timezone: "America/Toronto" })).toThrowError(/already exists/);
    expect(() => createChapter(admin, { name: "Bad", city: "Nowhere", timezone: "Mars/Olympus" })).toThrow();
  });

  it("roles come from the database, so changing the role changes access immediately", () => {
    setMember(admin, london.id, { email: "lon.vol@example.test", role: "coordinator" });
    expect(isCoordinatorOf(lonVol, london.id)).toBe(true);
    removeMember(admin, london.id, lonVol.id);
    expect(isCoordinatorOf(lonVol, london.id)).toBe(false);
  });
});
