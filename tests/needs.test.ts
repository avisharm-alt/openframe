import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, makeUser } from "./helpers";
import { getChapterBySlug } from "@/lib/services/access";
import { setMember } from "@/lib/services/chapters";
import { listItems } from "@/lib/services/items";
import { appendLedger } from "@/lib/services/inventory";
import { createNeed, listBoard, updateNeed } from "@/lib/services/needs";
import { assemblePackages } from "@/lib/services/packages";
import { createTemplate, deriveTemplateNeeds, listTemplates, updateTemplate } from "@/lib/services/templates";
import { setClock } from "@/lib/time";
import type { Actor } from "@/lib/types";

let london: ReturnType<typeof getChapterBySlug>;
let oshawa: ReturnType<typeof getChapterBySlug>;
let coord: Actor;
let item: (slug: string) => string;
const receive = (slug: string, n: number, chapterId = london.id) => appendLedger({ chapterId, itemId: item(slug), delta: n, kind: "received" });

beforeEach(() => {
  const db = freshDb();
  london = getChapterBySlug("london");
  oshawa = getChapterBySlug("oshawa");
  const admin = makeUser(db, "Admin", "admin");
  coord = makeUser(db, "London Coord");
  setMember(admin, london.id, { email: "london.coord@example.test", role: "coordinator" });
  const items = listItems();
  item = (slug) => items.find((i) => i.slug === slug)!.id;
});

describe("needs derived from templates and stock", () => {
  const winterKit = () => createTemplate(coord, london.id, {
    name: "Test winter kit",
    weeklyTarget: 10,
    items: [{ itemId: item("socks"), quantity: 2 }, { itemId: item("toque"), quantity: 1 }, { itemId: item("gloves"), quantity: 1 }],
  });

  it("shortfall = target packages x contents - current stock", () => {
    winterKit();
    receive("socks", 5);
    receive("toque", 10);
    const d = Object.fromEntries(deriveTemplateNeeds(london.id).map((n) => [n.itemId, n]));
    expect(d[item("socks")]).toMatchObject({ target: 20, stock: 5, shortfall: 15 });
    expect(d[item("toque")]).toMatchObject({ target: 10, stock: 10, shortfall: 0 });
    expect(d[item("gloves")]).toMatchObject({ target: 10, stock: 0, shortfall: 10 });
  });

  it("the public board recomputes live as stock changes, most pressing first, without anyone running a drive", () => {
    winterKit();
    let board = listBoard(london.id);
    expect(board.map((l) => l.itemName).sort()).toEqual(["Gloves or mittens", "Socks", "Toque (winter hat)"]);
    expect(board.find((l) => l.itemName === "Socks")).toMatchObject({ needed: 20, received: 0, pledged: 0, remaining: 20, source: "template" });
    receive("toque", 10); // toques fully covered: drops off the board
    receive("socks", 18);
    board = listBoard(london.id);
    expect(board.map((l) => l.itemName)).not.toContain("Toque (winter hat)");
    expect(board.find((l) => l.itemName === "Socks")).toMatchObject({ needed: 20, received: 18, remaining: 2 });
    // Sorted by priority then shortfall: gloves (empty shelf = high) before socks (nearly covered = normal).
    expect(board.map((l) => l.itemName)).toEqual(["Gloves or mittens", "Socks"]);
  });

  it("inactive templates and zero targets create no needs; editing a template updates the board", () => {
    const t = winterKit();
    updateTemplate(coord, t.id, { active: false });
    expect(listBoard(london.id)).toEqual([]);
    updateTemplate(coord, t.id, { active: true, weeklyTarget: 0 });
    expect(listBoard(london.id)).toEqual([]);
    updateTemplate(coord, t.id, { weeklyTarget: 3 });
    expect(listBoard(london.id).find((l) => l.itemName === "Socks")!.needed).toBe(6);
    updateTemplate(coord, t.id, { items: [{ itemId: item("socks"), quantity: 1 }] });
    expect(listBoard(london.id).map((l) => l.itemName)).toEqual(["Socks"]);
  });

  it("packages already assembled this week count toward the weekly target; next week starts fresh", () => {
    // Wednesday 2026-11-04 noon Toronto
    setClock(new Date("2026-11-04T17:00:00Z"));
    const t = createTemplate(coord, london.id, { name: "Mini", weeklyTarget: 4, items: [{ itemId: item("socks"), quantity: 2 }] });
    receive("socks", 8);
    expect(listBoard(london.id)).toEqual([]); // 8 socks = exactly 4 kits
    assemblePackages(coord, london.id, { templateId: t.id, count: 4 });
    // Shelf is empty but the weekly target of 4 kits is already assembled: nothing more is needed this week.
    expect(listBoard(london.id)).toEqual([]);
    // Following Monday: the target applies again and the empty shelf shows up as a need.
    setClock(new Date("2026-11-09T17:00:00Z"));
    expect(listBoard(london.id)).toHaveLength(1);
    expect(listBoard(london.id)[0]).toMatchObject({ itemName: "Socks", needed: 8, remaining: 8 });
  });

  it("stays separate per chapter", () => {
    winterKit();
    expect(listBoard(oshawa.id)).toEqual([]);
  });
});

describe("manually posted needs", () => {
  it("appear on the board with priority and sort by priority then shortfall", () => {
    createNeed(coord, london.id, { itemId: item("scarf"), quantity: 50, priority: "low" });
    createNeed(coord, london.id, { itemId: item("pads"), quantity: 10, priority: "urgent", note: "Running out" });
    createNeed(coord, london.id, { itemId: item("tampons"), quantity: 40, priority: "urgent" });
    expect(listBoard(london.id).map((l) => l.itemName)).toEqual(["Tampons", "Menstrual pads", "Scarf or neck warmer"]);
    expect(listBoard(london.id)[1].note).toBe("Running out");
  });

  it("can be closed, reopened and edited; a duplicate open need for an item is refused", () => {
    const n = createNeed(coord, london.id, { itemId: item("scarf"), quantity: 5 });
    expect(() => createNeed(coord, london.id, { itemId: item("scarf"), quantity: 5 })).toThrowError(/already a posted need/);
    updateNeed(coord, n.needId, { status: "closed" });
    expect(listBoard(london.id)).toEqual([]);
    updateNeed(coord, n.needId, { status: "open", quantity: 9 });
    expect(listBoard(london.id)[0]).toMatchObject({ needed: 9 });
  });

  it("derived (template) needs cannot be edited directly", () => {
    createTemplate(coord, london.id, { name: "T", weeklyTarget: 2, items: [{ itemId: item("socks"), quantity: 1 }] });
    const line = listBoard(london.id)[0];
    expect(() => updateNeed(coord, line.needId, { quantity: 1 })).toThrowError(/calculated from package templates/);
  });
});

describe("seed data", () => {
  it("ships the catalog and an inactive sample Winter kit in each chapter, so nothing is claimed publicly by default", () => {
    expect(listItems().length).toBeGreaterThanOrEqual(20);
    for (const slug of ["london", "oshawa"]) {
      const t = listTemplates(getChapterBySlug(slug).id).find((x) => x.name === "Winter kit")!;
      expect(t).toMatchObject({ active: false, weeklyTarget: 0 });
      expect(t.items.length).toBeGreaterThanOrEqual(8);
      expect(listBoard(getChapterBySlug(slug).id)).toEqual([]);
    }
  });
  it("marks coats as clean-second-hand-ok and everything else new-only", () => {
    const coats = listItems().filter((i) => !i.newOnly).map((i) => i.slug);
    expect(coats).toEqual(["winter-coat"]);
  });
});
