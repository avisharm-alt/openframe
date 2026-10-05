import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { world, FRIDAY, NEEDED_BY, type World } from "./fixtures";
import { getDb } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { CLAIM_STATUSES } from "@/lib/types";
import { setClock } from "@/lib/time";
import { resetRateLimits } from "@/lib/ratelimit";
import { assignVolunteer, confirmWindow } from "@/lib/services/pickups";
import { MAX_OPEN_PICKUPS, applyTransition, canTransition, cancelClaim, coordinatorTransition, getMyClaim, listAwaitingReceipt, listIncomingDropoffs, listMyClaims, receiveClaim, releaseStaleClaims, rescheduleClaim } from "@/lib/services/claims";
import { cancelRequest, listBoard } from "@/lib/services/requests";
import { stockOf } from "@/lib/services/stock";
import { loadRequest } from "@/lib/services/request-core";
import { sweep } from "@/lib/services/sweep";

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
const reqStatus = (id: string) => loadRequest(id).status;
const BOOTS = () => w.item("mens-winter-boots");

describe("claim state machine", () => {
  it("allows exactly the documented transitions for pickups", () => {
    const ok: [string, string][] = [["claimed", "scheduled"], ["claimed", "cancelled"], ["scheduled", "claimed"], ["scheduled", "collected"], ["scheduled", "cancelled"], ["scheduled", "no_show"], ["collected", "received"]];
    for (const from of CLAIM_STATUSES) for (const to of CLAIM_STATUSES) {
      expect(canTransition("pickup", from, to), `pickup ${from} -> ${to}`).toBe(ok.some(([a, b]) => a === from && b === to));
    }
  });

  it("drop-offs may also be collected or counted straight in, and no claim leaves a terminal state", () => {
    expect(canTransition("dropoff", "scheduled", "received")).toBe(true);
    expect(canTransition("dropoff", "scheduled", "collected")).toBe(true);
    expect(canTransition("dropoff", "scheduled", "claimed")).toBe(false);
    expect(canTransition("dropoff", "collected", "cancelled")).toBe(false);
    for (const terminal of ["received", "cancelled", "no_show"] as const) for (const to of CLAIM_STATUSES) {
      expect(canTransition("dropoff", terminal, to)).toBe(false);
      expect(canTransition("pickup", terminal, to)).toBe(false);
    }
  });

  it("a pickup cannot skip ahead; a drop-off starts scheduled", () => {
    const id = w.claimPickup(w.neighbour, w.post());
    expect(getMyClaim(w.neighbour, id).status).toBe("claimed");
    for (const to of ["received", "collected", "no_show"] as const) expect(code(() => applyTransition(id, to))).toBe("invalid_transition");
    expect(code(() => coordinatorTransition(w.lonCoord, id, { status: "collected", reason: "forced through" }))).toBe("invalid_transition");
    const d = w.claimDropoff(w.neighbour2, w.post());
    expect(getMyClaim(w.neighbour2, d).status).toBe("scheduled");
  });

  it("sets closed_at when a claim is collected, cancelled or a no-show (this starts the purge clock)", () => {
    const a = w.claimDropoff(w.neighbour, w.post());
    expect(getDb().prepare("SELECT closed_at FROM claim WHERE id = ?").get(a)).toEqual({ closed_at: null });
    coordinatorTransition(w.lonCoord, a, { status: "no_show" });
    expect((getDb().prepare("SELECT closed_at FROM claim WHERE id = ?").get(a) as { closed_at: string }).closed_at).toBe("2026-11-02T15:00:00.000Z");
  });
});

describe("the request status follows its claims (open -> claimed -> in_transit)", () => {
  it("open -> claimed when fully committed, and back to open when a claim is cancelled", () => {
    const r = w.post({ quantity: 4 });
    expect(reqStatus(r)).toBe("open");
    const a = w.claimDropoff(w.neighbour, r, { quantity: 2 });
    expect(reqStatus(r)).toBe("open"); // half claimed
    const b = w.claimDropoff(w.neighbour2, r, { quantity: 2 });
    expect(reqStatus(r)).toBe("claimed");
    expect(w.sent.filter((m) => m.template === "request_claimed")).toHaveLength(1);
    expect(w.sent.find((m) => m.template === "request_claimed")!.to).toBe("ark.worker@example.test");
    cancelClaim(w.neighbour2, b);
    expect(reqStatus(r)).toBe("open");
    expect(listBoard(w.london.id)[0]).toMatchObject({ remaining: 2 });
    void a;
  });

  it("claimed -> in_transit once the claims are counted in (the units are allocated to the request)", () => {
    const r = w.post({ quantity: 4 });
    const c = w.claimDropoff(w.neighbour, r, { quantity: 4 });
    expect(reqStatus(r)).toBe("claimed");
    expect(receiveClaim(w.lonCoord, c, { quantity: 4 })).toEqual({ received: 4, allocatedToRequest: 4 });
    expect(reqStatus(r)).toBe("in_transit");
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(0); // received then allocated
    expect(w.sent.map((m) => m.template)).toContain("request_ready");
  });
});

describe("partial claims", () => {
  it("lets several neighbours claim parts of one request, never more than is left", () => {
    const r = w.post({ quantity: 6 });
    w.claimPickup(w.neighbour, r, { quantity: 2 });
    expect(code(() => w.claimDropoff(w.neighbour2, r, { quantity: 5 }))).toBe("quantity_exceeded");
    w.claimDropoff(w.neighbour2, r, { quantity: 4 });
    expect(code(() => w.claimDropoff(w.stranger, r, { quantity: 1 }))).toBe("quantity_exceeded"); // fully claimed
    expect(listBoard(w.london.id)).toEqual([]);
  });

  it("when someone brings fewer than they claimed, the rest reopens for others", () => {
    const r = w.post({ quantity: 6 });
    const a = w.claimDropoff(w.neighbour, r, { quantity: 6 });
    receiveClaim(w.lonCoord, a, { quantity: 4, note: "two pairs did not fit" });
    expect(getMyClaim(w.neighbour, a)).toMatchObject({ status: "received", receivedQuantity: 4 });
    expect(reqStatus(r)).toBe("open");
    expect(listBoard(w.london.id)[0]).toMatchObject({ requestId: r, quantity: 6, remaining: 2 });
  });

  it("a worker cannot claim their own request, and a claim needs a real quantity", () => {
    const r = w.post();
    expect(code(() => w.claimDropoff(w.worker, r))).toBe("invalid");
    expect(code(() => w.claimDropoff(w.neighbour, r, { quantity: 0 }))).toBe("invalid");
    expect(code(() => w.claimDropoff(w.neighbour, "no-such-request"))).toBe("not_found");
  });
});

describe("claim limits and rules", () => {
  it("limits a neighbour to 3 open pickup claims, and frees a slot when one is cancelled", () => {
    const mk = (windowEnd: string) => w.claimPickup(w.neighbour, w.post({ quantity: 1 }), { quantity: 1, windows: [{ date: FRIDAY, start: "10:00", end: windowEnd }] });
    const ids = ["11:00", "12:00", "13:00"].map(mk);
    expect(ids).toHaveLength(MAX_OPEN_PICKUPS);
    expect(code(() => mk("14:00"))).toBe("pickup_limit");
    expect(w.claimDropoff(w.neighbour, w.post())).toBeTruthy(); // drop-offs are not limited by this rule
    cancelClaim(w.neighbour, ids[0]);
    expect(mk("14:00")).toBeTruthy();
    expect(w.claimPickup(w.neighbour2, w.post())).toBeTruthy(); // another neighbour is unaffected
  });

  it("rate-limits claim creation per neighbour", () => {
    resetRateLimits();
    const r = w.post({ quantity: 100 });
    let last = "";
    for (let i = 0; i < 12; i++) last = code(() => w.claimDropoff(w.neighbour, r, { quantity: 1 }));
    expect(last).toBe("rate_limited");
  });

  it("pickup windows and drop-off dates must be on or before the needed-by date", () => {
    const r = w.post({ neededBy: "2026-11-05" });
    expect(code(() => w.claimPickup(w.neighbour, r))).toBe("invalid"); // default windows are 6 and 7 Nov
    expect(code(() => w.claimPickup(w.neighbour, r, { windows: [{ date: "2026-11-04", start: "10:00", end: "12:00" }] }))).toBe("no error");
    expect(code(() => w.claimDropoff(w.neighbour2, r, { expectedDate: "2026-11-06" }))).toBe("invalid");
    expect(code(() => w.claimDropoff(w.neighbour2, r, { expectedDate: "2026-11-05" }))).toBe("no error");
    expect(code(() => w.claimDropoff(w.neighbour2, r, { expectedDate: "2026-10-30" }))).toBe("invalid"); // past
  });

  it("drop-offs need an active zone of the same chapter and reject free-form addresses", () => {
    const r = w.post({ quantity: 20 });
    expect(code(() => w.claimDropoff(w.neighbour, r, { zoneId: "does-not-exist" }))).toBe("not_found");
    expect(code(() => w.claimDropoff(w.neighbour, r, { address: "1 Main St" }))).toBe("invalid");
  });

  it("closed, cancelled and delivered requests cannot be claimed", () => {
    const r = w.post();
    cancelRequestSql(r);
    expect(code(() => w.claimDropoff(w.neighbour, r))).toBe("request_closed");
  });

  it("only the claiming neighbour can read, cancel or reschedule a claim", () => {
    const id = w.claimPickup(w.neighbour, w.post());
    expect(listMyClaims(w.neighbour).map((c) => c.id)).toEqual([id]);
    expect(listMyClaims(w.neighbour2)).toEqual([]);
    expect(code(() => getMyClaim(w.neighbour2, id))).toBe("not_found");
    expect(code(() => cancelClaim(w.neighbour2, id))).toBe("not_found");
    expect(code(() => rescheduleClaim(w.neighbour2, id, { windows: [{ date: FRIDAY, start: "10:00", end: "11:00" }] }))).toBe("not_found");
  });
});
function cancelRequestSql(id: string) {
  getDb().prepare("UPDATE request SET status = 'cancelled' WHERE id = ?").run(id);
}

describe("claim auto-release after 48 hours", () => {
  it("releases a pickup claim that is still unscheduled after 48 hours; the request reopens and the neighbour is told", () => {
    const r = w.post({ quantity: 6 });
    const c = w.claimPickup(w.neighbour, r, { quantity: 6 });
    expect(reqStatus(r)).toBe("claimed");
    setClock(new Date("2026-11-04T14:59:00Z")); // 47h59m later
    expect(releaseStaleClaims()).toBe(0);
    setClock(new Date("2026-11-04T15:00:00Z")); // exactly 48h
    expect(releaseStaleClaims()).toBe(1);
    expect(getMyClaim(w.neighbour, c)).toMatchObject({ status: "cancelled" });
    expect(getDb().prepare("SELECT status_reason FROM claim WHERE id = ?").get(c)).toEqual({ status_reason: "Released: not scheduled within 48 hours" });
    expect(reqStatus(r)).toBe("open");
    expect(listBoard(w.london.id)[0]).toMatchObject({ requestId: r, remaining: 6 });
    expect(w.sent.map((m) => m.template)).toContain("claim_released");
    expect(getDb().prepare("SELECT action FROM audit_event WHERE action = 'claim_auto_released'").all()).toHaveLength(1);
    expect(releaseStaleClaims()).toBe(0); // idempotent
  });

  it("does not release a claim that has been scheduled, nor a drop-off (which is scheduled from the start)", () => {
    const r = w.post({ quantity: 6 });
    const p = w.claimPickup(w.neighbour, r, { quantity: 3 });
    const d = w.claimDropoff(w.neighbour2, r, { quantity: 3, expectedDate: "2026-11-09" });
    const pk = w.pickupOf(w.neighbour, p);
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    expect(getMyClaim(w.neighbour, p).status).toBe("scheduled");
    setClock(new Date("2026-11-04T16:00:00Z"));
    expect(releaseStaleClaims()).toBe(0);
    expect(getMyClaim(w.neighbour2, d).status).toBe("scheduled");
  });

  it("a scheduled pickup that loses a volunteer goes back to claimed and gets a fresh 48 hours", () => {
    const r = w.post();
    const p = w.claimPickup(w.neighbour, r);
    const pk = w.pickupOf(w.neighbour, p);
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    setClock(new Date("2026-11-04T10:00:00Z"));
    getDb().prepare("DELETE FROM pickup_assignment WHERE volunteer_id = ?").run(w.vol2.id);
    applyTransition(p, "claimed", "volunteer dropped"); // what unassign does
    setClock(new Date("2026-11-05T10:00:00Z")); // 48h after the original claim, 24h after the reopen
    expect(releaseStaleClaims()).toBe(0);
    setClock(new Date("2026-11-06T10:00:00Z"));
    expect(releaseStaleClaims()).toBe(1);
  });

  it("is run by the sweep job, and the release time is configurable", () => {
    const r = w.post();
    w.claimPickup(w.neighbour, r);
    process.env.CLAIM_RELEASE_HOURS = "12";
    try {
      const c2 = w.claimPickup(w.neighbour2, w.post());
      setClock(new Date("2026-11-03T04:00:00Z")); // 13h later: the 12h claim is due, the first (48h) is not
      expect(sweep().released).toBe(1);
      expect(getMyClaim(w.neighbour2, c2).status).toBe("cancelled");
    } finally {
      delete process.env.CLAIM_RELEASE_HOURS;
    }
  });
});

describe("receiving claims into fast stock", () => {
  it("counts what arrived (which can differ from the claim), plus unclaimed extras, into stock", () => {
    const r = w.post({ quantity: 6 });
    const c = w.claimDropoff(w.neighbour, r, { quantity: 6 });
    expect(listIncomingDropoffs(w.lonCoord, w.london.id)).toMatchObject([{ zoneName: "Western UCC front desk", expectedDate: "2026-11-05", items: "6 × Men's winter boots (size 11)" }]);
    expect(listAwaitingReceipt(w.lonCoord, w.london.id)).toHaveLength(1);
    const res = receiveClaim(w.lonCoord, c, { quantity: 5, extras: [{ itemId: w.item("toque"), size: "", quantity: 3 }], note: "one pair was the wrong size" });
    expect(res).toEqual({ received: 8, allocatedToRequest: 5 });
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(0);
    expect(stockOf(w.london.id, w.item("toque"))).toBe(3);
    expect(getMyClaim(w.neighbour, c)).toMatchObject({ status: "received", receivedQuantity: 5, wentToStock: 0 });
    expect(listAwaitingReceipt(w.lonCoord, w.london.id)).toEqual([]);
  });

  it("items collected for a request that was cancelled meanwhile go into stock, not onto the dead request", () => {
    const r = w.post({ quantity: 4 });
    const c = w.claimDropoff(w.neighbour, r, { quantity: 4 });
    coordinatorTransition(w.lonCoord, c, { status: "collected" });
    cancelRequest(w.worker, r);
    expect(loadRequest(r).status).toBe("cancelled");
    expect(receiveClaim(w.lonCoord, c, { quantity: 4 })).toEqual({ received: 4, allocatedToRequest: 0 });
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(4);
    expect(loadRequest(r).status).toBe("cancelled");
  });

  it("requires a valid count, refuses an all-zero receipt, and cross-chapter receiving", () => {
    const r = w.post();
    const c = w.claimDropoff(w.neighbour, r);
    expect(code(() => receiveClaim(w.lonCoord, c, {}))).toBe("invalid");
    expect(code(() => receiveClaim(w.lonCoord, c, { quantity: 0 }))).toBe("invalid");
    expect(code(() => receiveClaim(w.oshCoord, c, { quantity: 2 }))).toBe("forbidden");
    expect(code(() => receiveClaim(w.vol1, c, { quantity: 2 }))).toBe("forbidden");
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(0); // nothing leaked in
  });

  it("a pickup claim cannot be counted in before the volunteers collected it; receiving twice is refused", () => {
    const p = w.claimPickup(w.neighbour, w.post());
    expect(code(() => receiveClaim(w.lonCoord, p, { quantity: 2 }))).toBe("invalid_transition");
    const d = w.claimDropoff(w.neighbour2, w.post());
    receiveClaim(w.lonCoord, d, { quantity: 2 });
    expect(code(() => receiveClaim(w.lonCoord, d, { quantity: 2 }))).toBe("invalid_transition");
  });

  it("is atomic: a failing extra rolls the whole receipt back", () => {
    const r = w.post();
    const c = w.claimDropoff(w.neighbour, r);
    expect(code(() => receiveClaim(w.lonCoord, c, { quantity: 2, extras: [{ itemId: w.item("mens-winter-boots"), size: "", quantity: 1 }] }))).toBe("invalid"); // sized item needs a size
    expect(getMyClaim(w.neighbour, c).status).toBe("scheduled");
    expect(stockOf(w.london.id, BOOTS(), "11")).toBe(0);
  });
});

describe("rescheduling", () => {
  it("changes a drop-off's zone and date within the needed-by date", () => {
    const c = w.claimDropoff(w.neighbour, w.post());
    rescheduleClaim(w.neighbour, c, { zoneId: w.zone.id, expectedDate: "2026-11-09" });
    expect(getMyClaim(w.neighbour, c).expectedDate).toBe("2026-11-09");
    expect(code(() => rescheduleClaim(w.neighbour, c, { zoneId: w.zone.id, expectedDate: "2026-11-11" }))).toBe("invalid");
  });

  it("replaces a pickup's windows; a scheduled pickup goes back to claimed to be re-confirmed", () => {
    const c = w.claimPickup(w.neighbour, w.post());
    const pk = w.pickupOf(w.neighbour, c);
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    rescheduleClaim(w.neighbour, c, { windows: [{ date: "2026-11-09", start: "09:00", end: "11:00" }] });
    const after = getMyClaim(w.neighbour, c);
    expect(after.status).toBe("claimed");
    expect(after.pickup!.scheduledWindowId).toBeNull();
    expect(after.pickup!.windows.map((x) => x.date)).toEqual(["2026-11-09"]);
    expect(after.pickup!.volunteerCount).toBe(2);
    expect(code(() => rescheduleClaim(w.neighbour, c, { windows: [{ date: "2026-11-12", start: "09:00", end: "11:00" }] }))).toBe("invalid"); // after needed-by
  });
});

describe("views", () => {
  it("shows the request, partner and release deadline on My claims", () => {
    const c = w.claimPickup(w.neighbour, w.post());
    expect(getMyClaim(w.neighbour, c)).toMatchObject({
      status: "claimed", quantity: 2, releaseAt: "2026-11-04T15:00:00.000Z",
      request: { label: "Men's winter boots (size 11)", partnerName: "Ark Aid Street Mission", siteName: "Ark Aid main building", neededBy: NEEDED_BY, status: "open" },
      delivered: null,
    });
  });
});
