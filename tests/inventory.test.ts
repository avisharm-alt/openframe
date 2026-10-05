import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeUser } from "./helpers";
import { getDb } from "@/lib/db";
import { getChapterBySlug } from "@/lib/services/access";
import { setMember } from "@/lib/services/chapters";
import { listItems } from "@/lib/services/items";
import { adjustStock, appendLedger, listInventory, listLedger, stockOf } from "@/lib/services/inventory";
import { assemblePackages, handOffPackages, listAssemblable, listPackages } from "@/lib/services/packages";
import { createPartner } from "@/lib/services/chapters";
import { createTemplate } from "@/lib/services/templates";
import type { Actor } from "@/lib/types";
import { localDate } from "@/lib/time";

let london: ReturnType<typeof getChapterBySlug>;
let coord: Actor;
let item: (slug: string) => string;

beforeEach(() => {
  const db = freshDb();
  london = getChapterBySlug("london");
  const admin = makeUser(db, "Admin", "admin");
  coord = makeUser(db, "London Coord");
  setMember(admin, london.id, { email: "london.coord@example.test", role: "coordinator" });
  const items = listItems();
  item = (slug) => items.find((i) => i.slug === slug)!.id;
});

describe("inventory ledger", () => {
  it("stock is the sum of the ledger", () => {
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 10, kind: "received" });
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: -3, kind: "discarded" });
    adjustStock(coord, london.id, { kind: "adjusted", itemId: item("socks"), delta: 2, note: "recount" });
    expect(stockOf(london.id, item("socks"))).toBe(9);
    expect(listInventory(coord, london.id).find((r) => r.name === "Socks")!.stock).toBe(9);
    expect(listLedger(coord, london.id)).toHaveLength(3);
  });

  it("stock can never go negative, in the service or in the database", () => {
    appendLedger({ chapterId: london.id, itemId: item("toque"), delta: 2, kind: "received" });
    expect(() => adjustStock(coord, london.id, { kind: "discarded", itemId: item("toque"), quantity: 3, note: "x" })).toThrowError(/not enough stock/i);
    expect(() => adjustStock(coord, london.id, { kind: "adjusted", itemId: item("toque"), delta: -3, note: "x" })).toThrowError(/not enough stock/i);
    expect(stockOf(london.id, item("toque"))).toBe(2);
    // Bypass the service: the trigger still refuses.
    expect(() =>
      getDb().prepare("INSERT INTO inventory_ledger (id, chapter_id, item_id, delta, kind, created_at) VALUES ('z', ?, ?, -5, 'adjusted', 't')").run(london.id, item("toque")),
    ).toThrow(/stock_negative/);
  });

  it("is per chapter: Oshawa stock is separate", () => {
    const oshawa = getChapterBySlug("oshawa");
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 5, kind: "received" });
    expect(stockOf(oshawa.id, item("socks"))).toBe(0);
    expect(() => appendLedger({ chapterId: oshawa.id, itemId: item("socks"), delta: -1, kind: "discarded" })).toThrowError(/not enough stock/i);
  });

  it("is append-only", () => {
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 5, kind: "received" });
    expect(() => getDb().prepare("DELETE FROM inventory_ledger").run()).toThrow(/append-only/);
    expect(() => getDb().prepare("UPDATE inventory_ledger SET delta = 500").run()).toThrow(/append-only/);
  });

  it("rejects ledger rows with the wrong sign for their kind", () => {
    expect(() => appendLedger({ chapterId: london.id, itemId: item("socks"), delta: -1, kind: "received" })).toThrow();
    expect(() => appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 0, kind: "adjusted" })).toThrow();
  });
});

describe("assembling and handing off packages", () => {
  const kit = () =>
    createTemplate(coord, london.id, {
      name: "Test kit",
      weeklyTarget: 5,
      items: [{ itemId: item("socks"), quantity: 2 }, { itemId: item("toque"), quantity: 1 }],
    });

  it("shows which templates can be fully assembled from stock", () => {
    const t = kit();
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 7, kind: "received" });
    appendLedger({ chapterId: london.id, itemId: item("toque"), delta: 1, kind: "received" });
    let a = listAssemblable(coord, london.id).find((x) => x.templateId === t.id)!;
    expect(a.maxPackages).toBe(1); // limited by toques
    expect(a.missing).toEqual([{ itemId: item("toque"), name: "Toque (winter hat)", short: 1 }]);
    appendLedger({ chapterId: london.id, itemId: item("toque"), delta: 10, kind: "received" });
    a = listAssemblable(coord, london.id).find((x) => x.templateId === t.id)!;
    expect(a.maxPackages).toBe(3); // 7 socks / 2
    expect(a.missing.map((m) => m.name)).toEqual(["Socks"]);
  });

  it("assembly decrements stock for every item and records a package snapshot", () => {
    const t = kit();
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 6, kind: "received" });
    appendLedger({ chapterId: london.id, itemId: item("toque"), delta: 3, kind: "received" });
    const { packageIds } = assemblePackages(coord, london.id, { templateId: t.id, count: 3 });
    expect(packageIds).toHaveLength(3);
    expect(stockOf(london.id, item("socks"))).toBe(0);
    expect(stockOf(london.id, item("toque"))).toBe(0);
    const rows = getDb().prepare("SELECT kind, COUNT(*) n FROM inventory_ledger WHERE kind = 'assembled_into_package' GROUP BY kind").get() as { n: number };
    expect(rows.n).toBe(6); // 3 packages x 2 items
    expect(listPackages(coord, london.id, "assembled")).toHaveLength(3);
  });

  it("assembly is atomic: when one item is short nothing is written", () => {
    const t = kit();
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 100, kind: "received" });
    appendLedger({ chapterId: london.id, itemId: item("toque"), delta: 2, kind: "received" });
    expect(() => assemblePackages(coord, london.id, { templateId: t.id, count: 3 })).toThrowError(/not enough stock/i);
    expect(stockOf(london.id, item("socks"))).toBe(100);
    expect(stockOf(london.id, item("toque"))).toBe(2);
    expect(getDb().prepare("SELECT COUNT(*) n FROM package").get()).toEqual({ n: 0 });
  });

  it("rolls back already-written rows if the database trigger fires mid-way", () => {
    const t = kit();
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 4, kind: "received" });
    appendLedger({ chapterId: london.id, itemId: item("toque"), delta: 2, kind: "received" });
    // Simulate a concurrent writer draining toques between the service's check and its writes:
    // make the pre-check pass, then break the second package by emptying toques after the first one.
    const db = getDb();
    db.exec(`CREATE TEMP TRIGGER drain AFTER INSERT ON package WHEN (SELECT COUNT(*) FROM package) = 1
      BEGIN INSERT INTO inventory_ledger (id, chapter_id, item_id, delta, kind, created_at)
        VALUES ('drain', '${london.id}', '${item("toque")}', -1, 'discarded', 't'); END`);
    expect(() => assemblePackages(coord, london.id, { templateId: t.id, count: 2 })).toThrow();
    expect(db.prepare("SELECT COUNT(*) n FROM package").get()).toEqual({ n: 0 });
    expect(stockOf(london.id, item("socks"))).toBe(4);
    expect(stockOf(london.id, item("toque"))).toBe(2);
  });

  it("hands off to a partner of the same chapter only, once, not in the future", () => {
    const t = kit();
    appendLedger({ chapterId: london.id, itemId: item("socks"), delta: 4, kind: "received" });
    appendLedger({ chapterId: london.id, itemId: item("toque"), delta: 2, kind: "received" });
    const { packageIds } = assemblePackages(coord, london.id, { templateId: t.id, count: 2 });
    const agency = createPartner(coord, london.id, { name: "Shelter A", description: "Emergency shelter" });
    const today = localDate("America/Toronto");
    expect(() => handOffPackages(coord, london.id, { packageIds, agencyId: agency.id, date: "2999-01-01" })).toThrowError(/future/);
    expect(handOffPackages(coord, london.id, { packageIds, agencyId: agency.id, date: today })).toEqual({ handedOff: 2 });
    expect(() => handOffPackages(coord, london.id, { packageIds, agencyId: agency.id, date: today })).toThrowError(/already handed off/);
    const off = createPartner(coord, london.id, { name: "Closed", acceptsPackages: false });
    expect(() => handOffPackages(coord, london.id, { packageIds, agencyId: off.id, date: today })).toThrowError(/not accepting/);
  });
});
