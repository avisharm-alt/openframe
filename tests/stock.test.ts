import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { world, NEEDED_BY, type World } from "./fixtures";
import { getDb } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { setClock } from "@/lib/time";
import { adjustStock, appendLedger, listLedger, listStock, stockOf } from "@/lib/services/stock";
import { setTarget, syncRestock } from "@/lib/services/restock";
import { assembleKits, createKitTemplate, listAssemblable } from "@/lib/services/kits";
import { cancelRequest, createRequest, fillFromStock, listBoard, listRequests } from "@/lib/services/requests";
import { createClaim, getMyClaim, receiveClaim } from "@/lib/services/claims";
import { loadRequest } from "@/lib/services/request-core";

let w: World;
beforeEach(() => {
  w = world();
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZodError) return "invalid";
    return e instanceof ServiceError ? e.code : (e as Error).message;
  }
  return "no error";
};
const BOOTS = () => w.item("mens-winter-boots");

describe("fast stock ledger", () => {
  it("stock is the sum of the ledger, per item and size", () => {
    w.stock("mens-winter-boots", 10, "11");
    w.stock("mens-winter-boots", 4, "9");
    appendLedger({ chapterId: w.london.id, itemId: BOOTS(), size: "11", delta: -3, kind: "discarded" });
    adjustStock(w.lonCoord, w.london.id, { kind: "adjusted", itemId: BOOTS(), size: "11", delta: 2, note: "recount" });
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(9);
    expect(stockOf(w.london.id, BOOTS(), "9")).toBe(4);
    expect(stockOf(w.london.id, BOOTS(), "10")).toBe(0);
    const row = listStock(w.lonCoord, w.london.id).filter((r) => r.name === "Men's winter boots");
    expect(row.map((r) => [r.size, r.stock])).toEqual([["11", 9], ["9", 4]].sort());
    expect(listLedger(w.lonCoord, w.london.id).length).toBe(4);
  });

  it("stock can never go negative, in the service or in the database", () => {
    w.stock("toque", 2);
    expect(code(() => adjustStock(w.lonCoord, w.london.id, { kind: "discarded", itemId: w.item("toque"), quantity: 3, note: "x" }))).toBe("insufficient_stock");
    expect(code(() => adjustStock(w.lonCoord, w.london.id, { kind: "adjusted", itemId: w.item("toque"), delta: -3, note: "x" }))).toBe("insufficient_stock");
    expect(stockOf(w.london.id, w.item("toque"))).toBe(2);
    expect(() => getDb().prepare("INSERT INTO stock_ledger (id, chapter_id, item_id, size, delta, kind, created_at) VALUES ('z', ?, ?, '', -5, 'adjusted', 't')").run(w.london.id, w.item("toque"))).toThrow(/stock_negative/);
  });

  it("is per size and per chapter", () => {
    w.stock("mens-winter-boots", 5, "11");
    expect(code(() => appendLedger({ chapterId: w.london.id, itemId: BOOTS(), size: "10", delta: -1, kind: "discarded" }))).toBe("insufficient_stock");
    expect(code(() => appendLedger({ chapterId: w.oshawa.id, itemId: BOOTS(), size: "11", delta: -1, kind: "discarded" }))).toBe("insufficient_stock");
  });

  it("is append-only, and validates sizes on manual changes", () => {
    w.stock("socks", 5);
    expect(() => getDb().prepare("DELETE FROM stock_ledger").run()).toThrow(/append-only/);
    expect(() => getDb().prepare("UPDATE stock_ledger SET delta = 500").run()).toThrow(/append-only/);
    expect(code(() => adjustStock(w.lonCoord, w.london.id, { kind: "adjusted", itemId: BOOTS(), size: "", delta: 1, note: "x" }))).toBe("invalid"); // boots need a size
    expect(code(() => adjustStock(w.lonCoord, w.london.id, { kind: "adjusted", itemId: w.item("socks"), size: "M", delta: 1, note: "x" }))).toBe("invalid");
  });

  it("rejects ledger rows with the wrong sign for their kind", () => {
    expect(() => appendLedger({ chapterId: w.london.id, itemId: w.item("socks"), delta: -1, kind: "received" })).toThrow();
    expect(() => appendLedger({ chapterId: w.london.id, itemId: w.item("socks"), delta: 1, kind: "allocated_to_request" })).toThrow();
    expect(() => appendLedger({ chapterId: w.london.id, itemId: w.item("socks"), delta: 0, kind: "adjusted" })).toThrow();
  });
});

describe("fill from stock", () => {
  it("allocates stock to the request in one step and moves it straight to in_transit", () => {
    w.stock("mens-winter-boots", 8, "11");
    const r = w.post({ quantity: 6 });
    expect(listRequests(w.lonCoord, w.london.id)[0]).toMatchObject({ id: r, status: "open", stockAvailable: 8, canFill: true });
    expect(fillFromStock(w.lonCoord, r)).toEqual({ status: "in_transit" });
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(2);
    expect(loadRequest(r)).toMatchObject({ status: "in_transit", filled_from_stock: 1 });
    expect(listBoard(w.london.id)).toEqual([]);
    expect(getDb().prepare("SELECT kind, delta, request_id AS r FROM stock_ledger WHERE kind = 'allocated_to_request'").all()).toEqual([{ kind: "allocated_to_request", delta: -6, r }]);
    expect(w.sent.map((m) => m.template)).toContain("request_ready");
  });

  it("refuses when stock is short, and changes nothing", () => {
    w.stock("mens-winter-boots", 5, "11");
    const r = w.post({ quantity: 6 });
    expect(listRequests(w.lonCoord, w.london.id)[0].canFill).toBe(false);
    expect(code(() => fillFromStock(w.lonCoord, r))).toBe("insufficient_stock");
    expect(() => fillFromStock(w.lonCoord, r)).toThrowError(/5 on the shelf, 6 needed/);
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(5);
    expect(loadRequest(r).status).toBe("open");
    w.stock("mens-winter-boots", 3, "9"); // wrong size does not help
    expect(code(() => fillFromStock(w.lonCoord, r))).toBe("insufficient_stock");
  });

  it("only coordinators of that chapter, and only open or claimed agency requests", () => {
    w.stock("mens-winter-boots", 6, "11");
    const r = w.post({ quantity: 6 });
    expect(code(() => fillFromStock(w.oshCoord, r))).toBe("forbidden");
    expect(code(() => fillFromStock(w.vol1, r))).toBe("forbidden");
    expect(code(() => fillFromStock(w.worker, r))).toBe("forbidden");
    fillFromStock(w.lonCoord, r);
    expect(code(() => fillFromStock(w.lonCoord, r))).toBe("not_fillable");
  });

  it("a request that neighbours partly claimed can still be filled; what they bring afterwards goes into stock", () => {
    w.stock("mens-winter-boots", 6, "11");
    const r = w.post({ quantity: 6 });
    const c = w.claimDropoff(w.neighbour, r, { quantity: 2 });
    fillFromStock(w.lonCoord, r);
    expect(loadRequest(r).status).toBe("in_transit");
    expect(receiveClaim(w.lonCoord, c, { quantity: 2 })).toEqual({ received: 2, allocatedToRequest: 0 });
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(2);
    expect(getMyClaim(w.neighbour, c)).toMatchObject({ status: "received", wentToStock: 2 });
  });

  it("cancelling an in-transit request returns its units to stock (coordinator only)", () => {
    w.stock("mens-winter-boots", 6, "11");
    const r = w.post({ quantity: 6 });
    fillFromStock(w.lonCoord, r);
    expect(code(() => cancelRequest(w.worker, r))).toBe("not_cancellable");
    cancelRequest(w.lonCoord, r, "Agency no longer needs them");
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(6);
    expect(loadRequest(r).status).toBe("cancelled");
  });
});

describe("kits", () => {
  const kit = () => createKitTemplate(w.lonCoord, w.london.id, { name: "Test kit", items: [{ itemId: w.item("socks"), quantity: 2 }, { itemId: w.item("toque"), quantity: 1 }] });

  it("shows which kit templates can be fully assembled from stock, and what is short", () => {
    const t = kit();
    w.stock("socks", 7);
    w.stock("toque", 1);
    let a = listAssemblable(w.lonCoord, w.london.id).find((x) => x.templateId === t.id)!;
    expect(a).toMatchObject({ maxKits: 1, assembled: 0, missing: [{ name: "Toque (winter hat)", short: 1 }] });
    w.stock("toque", 10);
    a = listAssemblable(w.lonCoord, w.london.id).find((x) => x.templateId === t.id)!;
    expect(a.maxKits).toBe(3);
  });

  it("assembly decrements every item in one transaction and records the kits", () => {
    const t = kit();
    w.stock("socks", 6);
    w.stock("toque", 3);
    const { kitIds } = assembleKits(w.lonCoord, w.london.id, { templateId: t.id, count: 3 });
    expect(kitIds).toHaveLength(3);
    expect(stockOf(w.london.id, w.item("socks"))).toBe(0);
    expect(stockOf(w.london.id, w.item("toque"))).toBe(0);
    expect(getDb().prepare("SELECT COUNT(*) n FROM stock_ledger WHERE kind = 'assembled_into_kit'").get()).toEqual({ n: 6 });
    expect(listAssemblable(w.lonCoord, w.london.id)[0].assembled).toBe(3);
  });

  it("assembly is atomic: when one item is short nothing is written", () => {
    const t = kit();
    w.stock("socks", 100);
    w.stock("toque", 2);
    expect(code(() => assembleKits(w.lonCoord, w.london.id, { templateId: t.id, count: 3 }))).toBe("insufficient_stock");
    expect(stockOf(w.london.id, w.item("socks"))).toBe(100);
    expect(stockOf(w.london.id, w.item("toque"))).toBe(2);
    expect(getDb().prepare("SELECT COUNT(*) n FROM kit").get()).toEqual({ n: 0 });
  });

  it("rolls back already-written rows if the database trigger fires part-way (a concurrent writer drains stock)", () => {
    const t = kit();
    w.stock("socks", 4);
    w.stock("toque", 2);
    const db = getDb();
    db.exec(`CREATE TEMP TRIGGER drain AFTER INSERT ON kit WHEN (SELECT COUNT(*) FROM kit) = 1
      BEGIN INSERT INTO stock_ledger (id, chapter_id, item_id, size, delta, kind, created_at) VALUES ('drain', '${w.london.id}', '${w.item("toque")}', '', -1, 'discarded', 't'); END`);
    expect(() => assembleKits(w.lonCoord, w.london.id, { templateId: t.id, count: 2 })).toThrow();
    expect(db.prepare("SELECT COUNT(*) n FROM kit").get()).toEqual({ n: 0 });
    expect(stockOf(w.london.id, w.item("socks"))).toBe(4);
    expect(stockOf(w.london.id, w.item("toque"))).toBe(2);
  });

  it("a kit request is filled from assembled kits, and refuses when too few are on the shelf", () => {
    const t = kit();
    const req = createRequest(w.worker, { type: "kit", partnerId: w.ark.id, siteId: w.arkSite.id, kitTemplateId: t.id, quantity: 3, neededBy: NEEDED_BY }).id;
    w.stock("socks", 4);
    w.stock("toque", 2);
    assembleKits(w.lonCoord, w.london.id, { templateId: t.id, count: 2 });
    expect(listRequests(w.lonCoord, w.london.id)[0]).toMatchObject({ id: req, type: "kit", stockAvailable: 2, canFill: false });
    expect(code(() => fillFromStock(w.lonCoord, req))).toBe("insufficient_kits");
    w.stock("socks", 2);
    w.stock("toque", 1);
    assembleKits(w.lonCoord, w.london.id, { templateId: t.id, count: 1 });
    expect(fillFromStock(w.lonCoord, req)).toEqual({ status: "in_transit" });
    expect(getDb().prepare("SELECT COUNT(*) n FROM kit WHERE request_id = ?").get(req)).toEqual({ n: 3 });
    // Cancelling it puts the kits back on the shelf.
    cancelRequest(w.lonCoord, req);
    expect(listAssemblable(w.lonCoord, w.london.id)[0].assembled).toBe(3);
  });
});

describe("restock auto-requests", () => {
  const target = (slug: string, size: string, n: number) => setTarget(w.lonCoord, w.london.id, { itemId: w.item(slug), size, target: n });
  const restock = () => listBoard(w.london.id).filter((c) => c.type === "restock");

  it("posts a chapter restock request when stock is below target, for the shortfall, distinct from agency requests", () => {
    w.stock("mens-winter-boots", 3, "11");
    target("mens-winter-boots", "11", 10);
    expect(restock()).toHaveLength(1);
    expect(restock()[0]).toMatchObject({ type: "restock", partnerName: null, siteName: null, quantity: 7, remaining: 7, urgency: "normal", claimable: true, label: "Men's winter boots (size 11)" });
    expect(restock()[0].neededBy).toBe("2026-11-09"); // a week out
    target("mens-winter-boots", "11", 12); // raising the target updates the untouched request
    expect(restock()[0].quantity).toBe(9);
    expect(restock()).toHaveLength(1); // still just one
  });

  it("is urgent when the shelf is empty, and not posted when stock meets target", () => {
    target("socks", "", 20);
    expect(restock()[0].urgency).toBe("urgent");
    w.stock("toque", 10);
    target("toque", "", 10);
    expect(restock().filter((c) => c.label.startsWith("Toque"))).toEqual([]);
  });

  it("posts automatically when stock drops (here: filling an agency request), so the board stays live", () => {
    w.stock("mens-winter-boots", 10, "11");
    target("mens-winter-boots", "11", 8);
    expect(restock()).toEqual([]);
    fillFromStock(w.lonCoord, w.post({ quantity: 6 })); // stock 10 -> 4, below the target of 8
    expect(restock()[0]).toMatchObject({ quantity: 4 });
  });

  it("withdraws an untouched restock request when stock recovers, but keeps one a neighbour has claimed", () => {
    target("socks", "", 10);
    expect(restock()).toHaveLength(1);
    w.stock("socks", 10);
    syncRestock(w.london.id);
    expect(restock()).toEqual([]);
    // Now a claimed one: below target again, a neighbour claims part, then stock is topped up by other means.
    appendLedger({ chapterId: w.london.id, itemId: w.item("socks"), delta: -10, kind: "discarded" });
    syncRestock(w.london.id);
    const id = restock()[0].requestId;
    createClaim(w.neighbour, { requestId: id, quantity: 4, method: "dropoff", zoneId: w.zone.id, expectedDate: "2026-11-05" });
    w.stock("socks", 10);
    syncRestock(w.london.id);
    expect(loadRequest(id).status).toBe("open"); // someone is already bringing socks: keep it
  });

  it("neighbour claims on a restock request go straight into stock and complete it", () => {
    target("socks", "", 10);
    const id = restock()[0].requestId;
    const c = createClaim(w.neighbour, { requestId: id, quantity: 10, method: "dropoff", zoneId: w.zone.id, expectedDate: "2026-11-05" }).id;
    expect(loadRequest(id).status).toBe("claimed");
    expect(receiveClaim(w.lonCoord, c, { quantity: 10 })).toEqual({ received: 10, allocatedToRequest: 0 });
    expect(stockOf(w.london.id, w.item("socks"))).toBe(10);
    expect(loadRequest(id).status).toBe("confirmed"); // nothing to deliver: stocked
    expect(restock()).toEqual([]); // target met, no new request
    expect(getMyClaim(w.neighbour, c)).toMatchObject({ status: "received", delivered: null, wentToStock: 10 });
  });

  it("removing a target withdraws its request; only coordinators of that chapter set targets", () => {
    target("socks", "", 10);
    expect(restock()).toHaveLength(1);
    target("socks", "", 0);
    expect(restock()).toEqual([]);
    expect(code(() => setTarget(w.oshCoord, w.london.id, { itemId: w.item("socks"), size: "", target: 5 }))).toBe("forbidden");
    expect(code(() => setTarget(w.vol1, w.london.id, { itemId: w.item("socks"), size: "", target: 5 }))).toBe("forbidden");
    expect(code(() => setTarget(w.lonCoord, w.london.id, { itemId: BOOTS(), size: "", target: 5 }))).toBe("invalid"); // boots need a size
  });

  it("the sweep keeps restock requests in step even when stock was changed behind the services' back", () => {
    target("socks", "", 10);
    appendLedger({ chapterId: w.london.id, itemId: w.item("socks"), delta: 10, kind: "received" });
    setClock(new Date("2026-11-03T10:00:00Z"));
    syncRestock(w.london.id);
    expect(restock()).toEqual([]);
  });
});
