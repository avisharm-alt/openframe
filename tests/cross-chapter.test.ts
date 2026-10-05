import { beforeEach, describe, expect, it } from "vitest";
import { world, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { setClock } from "@/lib/time";
import { addressAccess, assignVolunteer, confirmWindow, pickupBoard, signUpForSlot, unassignVolunteer, viewPickupDetails } from "@/lib/services/pickups";
import { coordinatorTransition, getMyClaim, listAwaitingReceipt, listIncomingDropoffs, receiveClaim } from "@/lib/services/claims";
import { fileConcern, listConcerns, updateConcern } from "@/lib/services/concerns";

let w: World;
beforeEach(() => {
  w = world();
});
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ServiceError ? e.status : 500;
  }
  return 200;
};

describe("an Oshawa coordinator or volunteer cannot touch London's claims, pickups or reports", () => {
  it("covers every claim and pickup coordinator action, with 403 or 404 and never success", () => {
    const claimId = w.claimPickup(w.neighbour, w.post());
    const drop = w.claimDropoff(w.neighbour2, w.post());
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    const { id: concernId } = fileConcern(w.neighbour, { claimId, category: "other", details: "x" });
    setClock(new Date("2026-11-06T15:00:00Z")); // inside the visibility window: only chapter membership could stop them

    const attempts: [string, () => unknown][] = [
      ["pickup board", () => pickupBoard(w.oshCoord, w.london.id)],
      ["assign", () => assignVolunteer(w.oshCoord, pk.id, { volunteerId: w.oshVol.id })],
      ["unassign", () => unassignVolunteer(w.oshCoord, pk.id, w.vol1.id)],
      ["confirm window", () => confirmWindow(w.oshCoord, pk.id, { windowId: pk.windows[1].id })],
      ["view address (coordinator)", () => viewPickupDetails(w.oshCoord, pk.id)],
      ["view address (volunteer)", () => viewPickupDetails(w.oshVol, pk.id)],
      ["view address (agency worker)", () => viewPickupDetails(w.worker, pk.id)],
      ["sign up for a slot", () => signUpForSlot(w.oshVol, pk.id)],
      ["transition", () => coordinatorTransition(w.oshCoord, claimId, { status: "cancelled" })],
      ["receive", () => receiveClaim(w.oshCoord, drop, { quantity: 2 })],
      ["incoming drop-offs", () => listIncomingDropoffs(w.oshCoord, w.london.id)],
      ["awaiting receipt", () => listAwaitingReceipt(w.oshCoord, w.london.id)],
      ["list concerns", () => listConcerns(w.oshCoord, w.london.id)],
      ["update concern", () => updateConcern(w.oshCoord, concernId, { state: "dismissed" })],
      ["file concern", () => fileConcern(w.oshVol, { claimId, category: "other", details: "x" })],
    ];
    for (const [name, fn] of attempts) expect([403, 404], name).toContain(status(fn));
    expect(addressAccess(w.oshCoord, pk.id)).toEqual({ allowed: false, reason: "not_related" });
    expect(addressAccess(w.worker, pk.id)).toEqual({ allowed: false, reason: "not_related" }); // the agency never sees a neighbour's address
    expect(getMyClaim(w.neighbour, claimId).status).toBe("scheduled");
    expect(getMyClaim(w.neighbour2, drop).status).toBe("scheduled");
    expect(status(() => pickupBoard(w.lonCoord, w.london.id))).toBe(200);
    expect(status(() => viewPickupDetails(w.lonCoord, pk.id))).toBe(200);
  });
});
