import { beforeEach, describe, expect, it } from "vitest";
import { world, type World } from "./fixtures";
import { setClock } from "@/lib/time";
import { getImpact, hoursBetween, median, summarize, TARGET_HOURS, type DeliveredRow } from "@/lib/services/impact";
import { assignDeliveryVolunteer, completeDelivery, createDelivery, startDelivery } from "@/lib/services/deliveries";
import { fillFromStock } from "@/lib/services/requests";
import { receiveClaim } from "@/lib/services/claims";

let w: World;
beforeEach(() => {
  w = world();
});

describe("median and the time-to-delivery metric", () => {
  it("median handles odd, even, empty and unsorted lists", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([10, 10, 100])).toBe(10); // robust to one slow delivery
  });

  it("summarize: median hours, % within 72h, % by needed-by, stock vs claims", () => {
    const row = (created: string, delivered: string, neededBy: string, stock: boolean): DeliveredRow => ({ createdAt: created, deliveredAt: delivered, neededBy, filledFromStock: stock, partnerName: "P" });
    const rows = [
      row("2026-11-02T15:00:00Z", "2026-11-02T20:00:00Z", "2026-11-05", true), // 5h
      row("2026-11-02T15:00:00Z", "2026-11-04T15:00:00Z", "2026-11-05", true), // 48h
      row("2026-11-02T15:00:00Z", "2026-11-06T15:00:00Z", "2026-11-05", false), // 96h, late
      row("2026-11-02T15:00:00Z", "2026-11-10T15:00:00Z", "2026-11-12", false), // 192h, on time
    ];
    expect(hoursBetween(rows[1].createdAt, rows[1].deliveredAt)).toBe(48);
    expect(summarize(rows, "America/Toronto")).toEqual({ medianHours: 72, within72hPct: 50, onTimePct: 75, fromStockPct: 50, fromClaimsPct: 50 });
    expect(TARGET_HOURS).toBe(72);
    expect(summarize([], "America/Toronto")).toEqual({ medianHours: null, within72hPct: null, onTimePct: null, fromStockPct: null, fromClaimsPct: null });
  });

  it("the delivered-on-local-date rule uses the chapter's timezone", () => {
    const late = { createdAt: "2026-11-02T15:00:00Z", deliveredAt: "2026-11-06T03:00:00Z", neededBy: "2026-11-05", filledFromStock: false, partnerName: "P" }; // 22:00 on the 5th in Toronto
    expect(summarize([late], "America/Toronto").onTimePct).toBe(100);
    expect(summarize([late], "UTC").onTimePct).toBe(0);
  });
});

/** Posts, fills and delivers a request, with the clock moving between steps. */
function deliver(opts: { postedAt: string; deliveredAt: string; fromStock: boolean; neededBy?: string; qty?: number }) {
  setClock(new Date(opts.postedAt));
  const r = w.post({ quantity: opts.qty ?? 2, neededBy: opts.neededBy ?? "2026-11-20", size: "10" });
  if (opts.fromStock) {
    w.stock("mens-winter-boots", opts.qty ?? 2, "10");
    fillFromStock(w.lonCoord, r);
  } else {
    const c = w.claimDropoff(w.neighbour, r, { quantity: opts.qty ?? 2, expectedDate: "2026-11-05" });
    receiveClaim(w.lonCoord, c, { quantity: opts.qty ?? 2 });
  }
  const { id } = createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: opts.deliveredAt.slice(0, 10) });
  assignDeliveryVolunteer(w.lonCoord, id, { volunteerId: w.vol1.id });
  setClock(new Date(new Date(opts.deliveredAt).getTime() - 3600_000));
  startDelivery(w.vol1, id);
  setClock(new Date(opts.deliveredAt));
  completeDelivery(w.vol1, id);
  return r;
}

describe("the public impact numbers", () => {
  it("leads with median time from request to delivery, and counts fulfilled requests per week and partner", () => {
    deliver({ postedAt: "2026-11-02T15:00:00Z", deliveredAt: "2026-11-02T21:00:00Z", fromStock: true }); // 6h
    deliver({ postedAt: "2026-11-02T15:00:00Z", deliveredAt: "2026-11-04T15:00:00Z", fromStock: false }); // 48h
    deliver({ postedAt: "2026-11-02T15:00:00Z", deliveredAt: "2026-11-09T15:00:00Z", fromStock: false, neededBy: "2026-11-05" }); // 168h, late, next week
    setClock(new Date("2026-11-10T15:00:00Z"));
    const i = getImpact();
    const london = i.chapters.find((c) => c.slug === "london")!;
    expect(london).toMatchObject({ fulfilled: 3, medianHours: 48, within72hPct: 67, onTimePct: 67, fromStockPct: 33, fromClaimsPct: 67 });
    expect(london.byPartner).toEqual([{ name: "Ark Aid Street Mission", fulfilled: 3 }]);
    expect(london.weekly).toHaveLength(12);
    expect(london.weekly.slice(-2)).toEqual([{ weekStart: "2026-11-02", fulfilled: 2 }, { weekStart: "2026-11-09", fulfilled: 1 }]);
    expect(i.overall).toEqual({ fulfilled: 3, medianHours: 48, within72hPct: 67 });
    expect(i.targetHours).toBe(72);
    expect(i.chapters.find((c) => c.slug === "oshawa")).toMatchObject({ fulfilled: 0, medianHours: null, within72hPct: null });
  });

  it("does not count open requests, restock requests or cancelled ones", () => {
    w.post();
    setClock(new Date("2026-11-03T15:00:00Z"));
    expect(getImpact().overall.fulfilled).toBe(0);
  });

  it("counts active neighbours and volunteer hours (pickups and delivery runs), as counts only", () => {
    deliver({ postedAt: "2026-11-02T15:00:00Z", deliveredAt: "2026-11-03T15:00:00Z", fromStock: false });
    const london = getImpact().chapters.find((c) => c.slug === "london")!;
    expect(london.activeNeighbours).toBe(1);
    expect(london.volunteerHours).toBe(1); // one volunteer on a one-hour run
    const text = JSON.stringify(getImpact());
    expect(text).not.toMatch(/Neighbour Two|"Neighbour"|Vol One|@example|Ark Worker/);
  });
});
