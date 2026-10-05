import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { world, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { setClock } from "@/lib/time";
import { assignDeliveryVolunteer, completeDelivery, confirmReceipt, createDelivery, listDeliverables, listDeliveries, myDeliveries, removeDeliveryVolunteer, startDelivery } from "@/lib/services/deliveries";
import { fillFromStock, listPartnerRequests, listRequests } from "@/lib/services/requests";
import { getMyClaim, receiveClaim } from "@/lib/services/claims";
import { loadRequest } from "@/lib/services/request-core";
import { setMember } from "@/lib/services/chapters";
import { acknowledgeSafety } from "@/lib/services/safety";
import { makeUser } from "./helpers";

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

/** A request that a neighbour's drop-off filled: in_transit and ready for a delivery. */
function inTransit(qty = 4) {
  const r = w.post({ quantity: qty });
  const c = w.claimDropoff(w.neighbour, r, { quantity: qty });
  receiveClaim(w.lonCoord, c, { quantity: qty });
  return { r, c };
}

describe("the full request lifecycle: open -> claimed -> in_transit -> delivered -> confirmed", () => {
  it("runs from the worker's request to the neighbour seeing 'Delivered to [partner]'", () => {
    const req2 = w.post({ quantity: 2 });
    expect(loadRequest(req2).status).toBe("open");
    setClock(new Date("2026-11-04T10:00:00Z"));
    const dropoff = w.claimDropoff(w.neighbour2, req2, { quantity: 2, expectedDate: "2026-11-04" });
    expect(loadRequest(req2).status).toBe("claimed");
    expect(getMyClaim(w.neighbour2, dropoff).delivered).toBeNull();
    receiveClaim(w.lonCoord, dropoff, { quantity: 2 });
    expect(loadRequest(req2).status).toBe("in_transit");

    setClock(new Date("2026-11-05T14:00:00Z"));
    expect(listDeliverables(w.lonCoord, w.london.id)).toMatchObject([{ requestId: req2, label: "2 × Men's winter boots (size 11)", siteName: "Ark Aid main building", partnerName: "Ark Aid Street Mission" }]);
    const { id: d } = createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [req2], plannedFor: "2026-11-05" });
    expect(listDeliverables(w.lonCoord, w.london.id)).toEqual([]); // now in a batch
    assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.vol1.id });
    expect(w.sent.map((m) => m.template)).toContain("delivery_assigned");
    expect(myDeliveries(w.vol1)[0]).toMatchObject({ id: d, status: "planned", site: { name: "Ark Aid main building", address: "696 Dundas St", receivingHours: "Mon–Fri 9:00–16:00" }, volunteers: [{ name: "Vol One" }] });
    startDelivery(w.vol1, d);
    expect(w.sent.find((m) => m.template === "delivery_on_the_way")!.to).toBe("ark.worker@example.test");
    expect(loadRequest(req2).status).toBe("in_transit");
    setClock(new Date("2026-11-05T16:30:00Z"));
    completeDelivery(w.vol1, d);
    expect(loadRequest(req2)).toMatchObject({ status: "delivered", delivered_at: "2026-11-05T16:30:00.000Z" });
    expect(w.sent.map((m) => m.template)).toEqual(expect.arrayContaining(["request_delivered", "claim_delivered"]));
    const toNeighbour = w.sent.find((m) => m.template === "claim_delivered")!;
    expect(toNeighbour.to).toBe("neighbour.two@example.test");
    expect(toNeighbour.subject).toBe("Delivered to Ark Aid Street Mission");
    // The feedback loop on My claims.
    expect(getMyClaim(w.neighbour2, dropoff).delivered).toEqual({ partnerName: "Ark Aid Street Mission", at: "2026-11-05T16:30:00.000Z", confirmed: false });

    // The agency worker confirms.
    expect(listPartnerRequests(w.worker, w.ark.id).find((x) => x.id === req2)).toMatchObject({ status: "delivered", canConfirm: true });
    confirmReceipt(w.worker, req2);
    expect(loadRequest(req2)).toMatchObject({ status: "confirmed", confirmed_by: w.worker.id });
    expect(getMyClaim(w.neighbour2, dropoff).delivered).toMatchObject({ confirmed: true });
    expect(code(() => confirmReceipt(w.worker, req2))).toBe("not_delivered");
  });

  it("a request filled from stock is delivered the same way, with no neighbour feedback", () => {
    w.stock("mens-winter-boots", 6, "11");
    const r = w.post({ quantity: 6 });
    fillFromStock(w.lonCoord, r);
    const { id: d } = createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-03" });
    assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.vol2.id });
    startDelivery(w.lonCoord, d);
    completeDelivery(w.vol2, d);
    expect(loadRequest(r).status).toBe("delivered");
    expect(w.sent.map((m) => m.template)).not.toContain("claim_delivered");
  });
});

describe("delivery batches", () => {
  it("must be for one site, only for in-hand requests, and a request goes on one batch only", () => {
    const a = inTransit();
    const b = w.post({ partnerId: w.other.id, siteId: w.otherSite.id }, w.worker2);
    expect(code(() => createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [a.r, b], plannedFor: "2026-11-05" }))).toBe("invalid"); // b is for another site
    expect(code(() => createDelivery(w.lonCoord, w.london.id, { siteId: w.otherSite.id, requestIds: [b], plannedFor: "2026-11-05" }))).toBe("not_ready"); // still open
    createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [a.r], plannedFor: "2026-11-05" });
    expect(code(() => createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [a.r], plannedFor: "2026-11-06" }))).toBe("already_in_delivery");
    expect(listDeliveries(w.lonCoord, w.london.id)).toHaveLength(1);
  });

  it("needs a volunteer who acknowledged the Safety rules before it goes out; only assigned volunteers or coordinators run it", () => {
    const { r } = inTransit();
    const { id: d } = createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-05" });
    expect(code(() => startDelivery(w.lonCoord, d))).toBe("no_volunteers");
    expect(code(() => assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.unackedVol.id }))).toBe("safety_not_acknowledged");
    expect(code(() => assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.oshVol.id }))).toBe("invalid");
    expect(code(() => assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.stranger.id }))).toBe("invalid");
    assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.vol1.id });
    expect(code(() => assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.vol1.id }))).toBe("already_assigned");
    expect(code(() => startDelivery(w.vol2, d))).toBe("not_found"); // not on this delivery
    expect(code(() => startDelivery(w.neighbour, d))).toBe("not_found");
    expect(code(() => completeDelivery(w.vol1, d))).toBe("delivery_not_out");
    startDelivery(w.vol1, d);
    expect(code(() => startDelivery(w.vol1, d))).toBe("delivery_started");
    expect(code(() => removeDeliveryVolunteer(w.lonCoord, d, w.vol1.id))).toBe("delivery_started");
    completeDelivery(w.lonCoord, d); // a coordinator may close it too
    expect(code(() => completeDelivery(w.vol1, d))).toBe("delivery_not_out");
  });

  it("is scoped: another chapter's coordinator, a partner worker or a neighbour cannot create or run one", () => {
    const { r } = inTransit();
    expect(code(() => createDelivery(w.oshCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-05" }))).toBe("forbidden");
    expect(code(() => createDelivery(w.worker, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-05" }))).toBe("forbidden");
    expect(code(() => createDelivery(w.lonCoord, w.oshawa.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-05" }))).toBe("forbidden");
    expect(code(() => listDeliverables(w.oshCoord, w.london.id))).toBe("forbidden");
    expect(code(() => listDeliveries(w.worker, w.london.id))).toBe("forbidden");
  });
});

describe("confirming receipt", () => {
  const delivered = () => {
    const { r } = inTransit();
    const { id: d } = createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-05" });
    assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.vol1.id });
    startDelivery(w.vol1, d);
    completeDelivery(w.vol1, d);
    return r;
  };
  it("by a worker of that partner, or recorded by a coordinator; nobody else", () => {
    const r = delivered();
    expect(code(() => confirmReceipt(w.worker2, r))).toBe("not_found"); // another partner's worker
    expect(code(() => confirmReceipt(w.pending, r))).toBe("not_found");
    expect(code(() => confirmReceipt(w.neighbour, r))).toBe("not_found");
    expect(code(() => confirmReceipt(w.oshCoord, r))).toBe("not_found");
    confirmReceipt(w.lonCoord, r);
    expect(loadRequest(r).status).toBe("confirmed");
  });
  it("cannot confirm something that has not been delivered", () => {
    const { r } = inTransit();
    expect(code(() => confirmReceipt(w.worker, r))).toBe("not_delivered");
  });
  it("shows overdue and at-risk requests in the coordinator's triage until delivered", () => {
    const r = w.post({ neededBy: "2026-11-03" });
    setClock(new Date("2026-11-04T15:00:00Z"));
    expect(listRequests(w.lonCoord, w.london.id).find((x) => x.id === r)).toMatchObject({ atRisk: true, overdue: true, daysLeft: -1 });
  });
});

describe("people removed from a chapter or deleted lose their delivery runs", () => {
  it("a deleted volunteer disappears from an open delivery", async () => {
    const { r } = inTransit();
    const { id: d } = createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-05" });
    const v = makeUser(w.db, "Extra Vol");
    setMember(w.lonCoord, w.london.id, { email: "extra.vol@example.test", role: "volunteer" });
    acknowledgeSafety(v);
    assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: v.id });
    const { deleteAccount } = await import("@/lib/services/account");
    deleteAccount(v.id);
    expect(listDeliveries(w.lonCoord, w.london.id)[0].volunteers).toEqual([]);
  });
});
