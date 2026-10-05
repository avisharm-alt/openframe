import { beforeEach, describe, expect, it } from "vitest";
import { world, FRIDAY, type World } from "./fixtures";
import { getDb } from "@/lib/db";
import { ZodError } from "zod";
import { ServiceError } from "@/lib/errors";
import { PLEDGE_STATUSES } from "@/lib/types";
import { assignVolunteer, confirmWindow } from "@/lib/services/pickups";
import { MAX_OPEN_PICKUPS, applyTransition, canTransition, cancelPledge, coordinatorTransition, getMyPledge, listAwaitingReceipt, listIncomingDropoffs, listMyPledges, receivePledge, reschedulePledge } from "@/lib/services/pledges";
import { listBoard } from "@/lib/services/needs";
import { stockOf } from "@/lib/services/inventory";
import { setClock } from "@/lib/time";
import { resetRateLimits } from "@/lib/ratelimit";

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

describe("pledge state machine", () => {
  it("allows exactly the documented transitions for pickups", () => {
    const ok: [string, string][] = [["pledged", "scheduled"], ["pledged", "cancelled"], ["scheduled", "pledged"], ["scheduled", "collected"], ["scheduled", "cancelled"], ["scheduled", "no_show"], ["collected", "received"]];
    for (const from of PLEDGE_STATUSES) for (const to of PLEDGE_STATUSES) {
      const expected = ok.some(([a, b]) => a === from && b === to);
      expect(canTransition("pickup", from, to), `pickup ${from} -> ${to}`).toBe(expected);
    }
  });

  it("drop-offs may also be collected or counted straight from pledged, and never leave a terminal state", () => {
    expect(canTransition("dropoff", "pledged", "received")).toBe(true);
    expect(canTransition("dropoff", "pledged", "collected")).toBe(true);
    expect(canTransition("dropoff", "scheduled", "pledged")).toBe(false);
    for (const terminal of ["received", "cancelled", "no_show"] as const) {
      for (const to of PLEDGE_STATUSES) {
        expect(canTransition("dropoff", terminal, to)).toBe(false);
        expect(canTransition("pickup", terminal, to)).toBe(false);
      }
    }
    expect(canTransition("dropoff", "collected", "cancelled")).toBe(false); // already collected
  });

  it("a pickup cannot skip ahead: no receiving it before it is collected, no no-show before it is scheduled", () => {
    const id = w.pickupPledge();
    expect(code(() => applyTransition(id, "received"))).toBe("invalid_transition");
    expect(code(() => applyTransition(id, "collected"))).toBe("invalid_transition");
    expect(code(() => applyTransition(id, "no_show"))).toBe("invalid_transition");
    expect(code(() => coordinatorTransition(w.lonCoord, id, { status: "collected", reason: "forced through" }))).toBe("invalid_transition");
  });

  it("walks a drop-off pledged -> collected -> received and refuses to go back", () => {
    const id = w.dropoffPledge();
    coordinatorTransition(w.lonCoord, id, { status: "collected" });
    expect(getMyPledge(w.donor, id).status).toBe("collected");
    expect(code(() => coordinatorTransition(w.lonCoord, id, { status: "cancelled" }))).toBe("invalid_transition");
    const line = getMyPledge(w.donor, id).items[0];
    receivePledge(w.lonCoord, id, { lines: [{ lineId: line.lineId, quantity: 6 }] });
    expect(getMyPledge(w.donor, id).status).toBe("received");
    expect(code(() => receivePledge(w.lonCoord, id, { lines: [{ lineId: line.lineId, quantity: 6 }] }))).toBe("invalid_transition");
  });

  it("sets closed_at when a pledge is collected, cancelled or a no-show (this starts the purge clock)", () => {
    const a = w.dropoffPledge();
    expect(getDb().prepare("SELECT closed_at FROM pledge WHERE id = ?").get(a)).toEqual({ closed_at: null });
    coordinatorTransition(w.lonCoord, a, { status: "no_show" });
    expect((getDb().prepare("SELECT closed_at FROM pledge WHERE id = ?").get(a) as { closed_at: string }).closed_at).toBe("2026-11-02T15:00:00.000Z");
    const b = w.pickupPledge();
    cancelPledge(w.donor, b);
    expect((getDb().prepare("SELECT closed_at FROM pledge WHERE id = ?").get(b) as { closed_at: string | null }).closed_at).not.toBeNull();
  });
});

describe("creating pledges", () => {
  it("records items against needs, and the live board shows pledged progress", () => {
    w.pickupPledge();
    const socks = listBoard(w.london.id).find((l) => l.itemName === "Socks")!;
    expect(socks).toMatchObject({ needed: 20, pledged: 4, received: 0, remaining: 16 });
    w.dropoffPledge(w.donor2);
    expect(listBoard(w.london.id).find((l) => l.itemName === "Socks")).toMatchObject({ pledged: 10, remaining: 10 });
  });

  it("refuses more than the remaining need, duplicate lines, other chapters' needs and closed needs", () => {
    expect(code(() => w.pickupPledge(w.donor, { items: [{ needId: w.socksNeed.needId, quantity: 21 }] }))).toBe("need_exceeded");
    expect(code(() => w.pickupPledge(w.donor, { items: [{ needId: w.socksNeed.needId, quantity: 1 }, { needId: w.socksNeed.needId, quantity: 1 }] }))).toBe("invalid");
    expect(code(() => w.pickupPledge(w.donor, { chapter: "oshawa" }))).toBe("invalid"); // needs belong to London
    expect(code(() => w.pickupPledge(w.donor, { items: [] }))).toBe("invalid");
  });

  it("requires a zone and an expected date for drop-offs, and only active zones of the same chapter", () => {
    expect(code(() => w.dropoffPledge(w.donor, { zoneId: undefined }))).not.toBe("no error");
    expect(code(() => w.dropoffPledge(w.donor, { expectedDate: "2026-10-01" }))).toBe("invalid");
    expect(code(() => w.dropoffPledge(w.donor, { expectedDate: "2027-06-01" }))).toBe("invalid");
    expect(code(() => w.dropoffPledge(w.donor, { zoneId: "does-not-exist" }))).toBe("not_found");
    expect(w.dropoffPledge()).toBeTruthy();
  });

  it("limits a donor to 3 open pickup pledges, and frees a slot when one is cancelled", () => {
    const small = (i: number) => ({ items: [{ needId: w.socksNeed.needId, quantity: 1 }], windows: [{ date: FRIDAY, start: "10:00", end: `1${i}:00` }] });
    const ids = [1, 2, 3].map((i) => w.pickupPledge(w.donor, small(i)));
    expect(ids).toHaveLength(MAX_OPEN_PICKUPS);
    expect(code(() => w.pickupPledge(w.donor, small(4)))).toBe("pickup_limit");
    expect(w.dropoffPledge(w.donor)).toBeTruthy(); // drop-offs are not limited by this rule
    cancelPledge(w.donor, ids[0]);
    expect(w.pickupPledge(w.donor, small(4))).toBeTruthy();
    // Another donor is unaffected.
    expect(w.pickupPledge(w.donor2, small(5))).toBeTruthy();
  });

  it("rate-limits pledge creation per donor", () => {
    resetRateLimits();
    let last = "";
    for (let i = 0; i < 12; i++) last = code(() => w.dropoffPledge(w.donor, { items: [{ needId: w.socksNeed.needId, quantity: 1 }] }));
    expect(last).toBe("rate_limited");
    expect(code(() => w.dropoffPledge(w.donor2, { items: [{ needId: w.socksNeed.needId, quantity: 1 }] }))).toBe("no error");
  });

  it("rejects fields we never accept (for example a free-form location for a drop-off)", () => {
    expect(code(() => w.dropoffPledge(w.donor, { address: ADDRESS_LIKE }))).toBe("invalid");
  });
});
const ADDRESS_LIKE = "1 Main St";

describe("donor actions", () => {
  it("lists only my own pledges, and nobody else can read or cancel them", () => {
    const id = w.pickupPledge();
    expect(listMyPledges(w.donor).map((p) => p.id)).toEqual([id]);
    expect(listMyPledges(w.donor2)).toEqual([]);
    expect(code(() => getMyPledge(w.donor2, id))).toBe("not_found");
    expect(code(() => cancelPledge(w.donor2, id))).toBe("not_found");
    expect(code(() => reschedulePledge(w.donor2, id, { windows: [{ date: FRIDAY, start: "10:00", end: "11:00" }] }))).toBe("not_found");
  });

  it("cancels while pledged or scheduled, not afterwards", () => {
    const id = w.dropoffPledge();
    cancelPledge(w.donor, id);
    expect(getMyPledge(w.donor, id).status).toBe("cancelled");
    expect(code(() => cancelPledge(w.donor, id))).toBe("not_cancellable");
    // Cancelled pledges stop counting toward the need.
    expect(listBoard(w.london.id).find((l) => l.itemName === "Socks")!.pledged).toBe(0);
  });

  it("reschedules a drop-off", () => {
    const id = w.dropoffPledge();
    reschedulePledge(w.donor, id, { zoneId: w.zone.id, expectedDate: "2026-11-09" });
    expect(getMyPledge(w.donor, id).expectedDate).toBe("2026-11-09");
    expect(code(() => reschedulePledge(w.donor, id, { zoneId: w.zone.id, expectedDate: "2020-01-01" }))).toBe("invalid");
  });

  it("rescheduling a scheduled pickup replaces the windows and sends it back to pledged for re-confirmation", () => {
    const id = w.pickupPledge();
    const pk = getMyPledge(w.donor, id).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    expect(getMyPledge(w.donor, id).status).toBe("scheduled");
    reschedulePledge(w.donor, id, { windows: [{ date: "2026-11-10", start: "09:00", end: "11:00" }] });
    const after = getMyPledge(w.donor, id);
    expect(after.status).toBe("pledged");
    expect(after.pickup!.scheduledWindowId).toBeNull();
    expect(after.pickup!.windows.map((x) => x.date)).toEqual(["2026-11-10"]);
    expect(after.pickup!.volunteerCount).toBe(2); // the volunteers stay assigned
  });
});

describe("receiving into stock", () => {
  it("counts a drop-off into inventory, can differ from what was pledged, and updates the need", () => {
    const id = w.dropoffPledge(w.donor, { items: [{ needId: w.socksNeed.needId, quantity: 6 }, { needId: w.toqueNeed.needId, quantity: 2 }] });
    const lines = getMyPledge(w.donor, id).items;
    expect(listIncomingDropoffs(w.lonCoord, w.london.id)).toMatchObject([{ zoneName: "Western UCC front desk", expectedDate: "2026-11-05", items: "6 × Socks, 2 × Toque (winter hat)" }]);
    expect(listAwaitingReceipt(w.lonCoord, w.london.id)).toHaveLength(1);
    // 5 socks arrived (not 6), no toques, plus 3 pairs of gloves nobody pledged.
    receivePledge(w.lonCoord, id, { lines: [{ lineId: lines[0].lineId, quantity: 5 }, { lineId: lines[1].lineId, quantity: 0 }], extras: [{ itemId: w.item("gloves"), quantity: 3 }] });
    expect(stockOf(w.london.id, w.item("socks"))).toBe(5);
    expect(stockOf(w.london.id, w.item("toque"))).toBe(0);
    expect(stockOf(w.london.id, w.item("gloves"))).toBe(3);
    const after = getMyPledge(w.donor, id);
    expect(after.items.map((l) => [l.itemName, l.quantity, l.receivedQuantity])).toEqual([["Socks", 6, 5], ["Toque (winter hat)", 2, 0], ["Gloves or mittens", 0, 3]]);
    // Socks need: 5 of 20 received; the unmet toques are open again (not pledged any more).
    const board = listBoard(w.london.id);
    expect(board.find((l) => l.itemName === "Socks")).toMatchObject({ needed: 20, received: 5, pledged: 0, remaining: 15 });
    expect(board.find((l) => l.itemName === "Toque (winter hat)")).toMatchObject({ received: 0, pledged: 0, remaining: 10 });
    expect(listAwaitingReceipt(w.lonCoord, w.london.id)).toHaveLength(0);
  });

  it("marks a need met once received quantities reach it, and drops it off the board", () => {
    const id = w.dropoffPledge(w.donor, { items: [{ needId: w.toqueNeed.needId, quantity: 10 }] });
    receivePledge(w.lonCoord, id, { lines: [{ lineId: getMyPledge(w.donor, id).items[0].lineId, quantity: 10 }] });
    expect(listBoard(w.london.id).map((l) => l.itemName)).not.toContain("Toque (winter hat)");
    expect((getDb().prepare("SELECT status FROM need WHERE id = ?").get(w.toqueNeed.needId) as { status: string }).status).toBe("met");
  });

  it("requires a count for every line, rejects an all-zero receipt and cross-chapter receiving", () => {
    const id = w.dropoffPledge(w.donor, { items: [{ needId: w.socksNeed.needId, quantity: 2 }, { needId: w.toqueNeed.needId, quantity: 2 }] });
    const [a, b] = getMyPledge(w.donor, id).items;
    expect(code(() => receivePledge(w.lonCoord, id, { lines: [{ lineId: a.lineId, quantity: 2 }] }))).toBe("invalid");
    expect(code(() => receivePledge(w.lonCoord, id, { lines: [{ lineId: a.lineId, quantity: 0 }, { lineId: b.lineId, quantity: 0 }] }))).toBe("invalid");
    expect(code(() => receivePledge(w.oshCoord, id, { lines: [{ lineId: a.lineId, quantity: 2 }, { lineId: b.lineId, quantity: 2 }] }))).toBe("forbidden");
    expect(stockOf(w.london.id, w.item("socks"))).toBe(0); // nothing leaked in
  });

  it("emails a thank-you with impact when items are counted", () => {
    const id = w.dropoffPledge();
    receivePledge(w.lonCoord, id, { lines: [{ lineId: getMyPledge(w.donor, id).items[0].lineId, quantity: 6 }] });
    const m = w.sent.find((x) => x.template === "thank_you")!;
    expect(m.to).toBe("donor@example.test");
    expect(m.text).toMatch(/6 items/);
    expect(m.text).toMatch(/received 6 items and handed off 0 packages/);
  });
});

describe("clock", () => {
  it("uses the injected clock", () => {
    setClock(new Date("2026-12-24T12:00:00Z"));
    expect(code(() => w.pickupPledge())).toBe("invalid"); // the Nov windows are now in the past
  });
});

describe("receiving a pledge twice or too early", () => {
  it("says the status does not allow it, before looking at the counts", () => {
    const id = w.pickupPledge();
    const line = getMyPledge(w.donor, id).items[0];
    expect(code(() => receivePledge(w.lonCoord, id, { lines: [{ lineId: line.lineId, quantity: 1 }] }))).toBe("invalid_transition"); // not collected yet
  });
});
