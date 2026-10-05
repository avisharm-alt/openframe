import { describe, expect, it } from "vitest";
import { freshDb, makeUser } from "./helpers";
import { getDb } from "@/lib/db";
import { getChapterBySlug } from "@/lib/services/access";
import { setMember } from "@/lib/services/chapters";
import { createPartner } from "@/lib/services/partners";
import { listItems } from "@/lib/services/items";
import { appendLedger } from "@/lib/services/inventory";
import { assemblePackages, handOffPackages } from "@/lib/services/packages";
import { createTemplate } from "@/lib/services/templates";
import { handoffSchema, partnerSchema } from "@/lib/validation";
import { localDate } from "@/lib/time";

// Recipients of care packages are never recorded: no names, descriptions or locations of the people served.
describe("no recipient data is ever stored", () => {
  it("the schema has no table or column for recipients", () => {
    const db = freshDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    const banned = /recipient|client|beneficiar|guest_|homeless|person_served|served|resident|camp|encampment|sighting|description_of/i;
    for (const t of tables) {
      expect(t).not.toMatch(banned);
      const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
      for (const c of cols) expect(`${t}.${c}`, `unexpected column ${t}.${c}`).not.toMatch(banned);
    }
  });

  it("the package and agency tables hold exactly what the design allows", () => {
    const db = freshDb();
    const cols = (t: string) => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name).sort();
    expect(cols("package")).toEqual(["agency_id", "assembled_at", "assembled_by", "chapter_id", "handed_off_by", "handed_off_on", "id", "status", "template_id", "template_name"]);
    expect(cols("package_item")).toEqual(["item_id", "package_id", "quantity"]);
    expect(cols("partner_agency")).toEqual(["accepts_packages", "active", "chapter_id", "created_at", "description", "id", "name"]);
  });

  it("the hand-off and partner APIs reject any extra field, so recipient details cannot be sent", () => {
    const base = { packageIds: ["12345678"], agencyId: "abcdefgh", date: "2026-01-01" };
    expect(handoffSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ recipientName: "A. Person" }, { recipient: "man near the bridge" }, { notes: "tent by the river" }, { location: "Dundas & Richmond" }, { description: "x" }]) {
      expect(handoffSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(partnerSchema.safeParse({ name: "Shelter", recipients: 40 }).success).toBe(false);
  });

  it("a full assemble and hand-off leaves only agency, date and contents behind", () => {
    const db = freshDb();
    const london = getChapterBySlug("london");
    const admin = makeUser(db, "Admin", "admin");
    const coord = makeUser(db, "Coord");
    setMember(admin, london.id, { email: "coord@example.test", role: "coordinator" });
    const socks = listItems().find((i) => i.slug === "socks")!.id;
    const t = createTemplate(coord, london.id, { name: "Kit", weeklyTarget: 1, items: [{ itemId: socks, quantity: 1 }] });
    appendLedger({ chapterId: london.id, itemId: socks, delta: 2, kind: "received" });
    const { packageIds } = assemblePackages(coord, london.id, { templateId: t.id, count: 2 });
    const agency = createPartner(coord, london.id, { name: "Shelter A", description: "Emergency shelter" });
    handOffPackages(coord, london.id, { packageIds, agencyId: agency.id, date: localDate("America/Toronto") });
    const rows = getDb().prepare("SELECT * FROM package").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["agency_id", "assembled_at", "assembled_by", "chapter_id", "handed_off_by", "handed_off_on", "id", "status", "template_id", "template_name"]);
    // And the agency can't take a package it doesn't accept packages from.
    expect(handoffSchema.safeParse({ packageIds, agencyId: agency.id, date: "2026-01-01", recipientAge: 40 }).success).toBe(false);
  });
});
