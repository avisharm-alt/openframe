import { beforeEach, describe, expect, it } from "vitest";
import { world, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { setClock } from "@/lib/time";
import { addressAccess, assignVolunteer, confirmWindow, pickupBoard, signUpForSlot, unassignVolunteer, viewPickupDetails } from "@/lib/services/pickups";
import { coordinatorTransition, getMyPledge, listAwaitingReceipt, listIncomingDropoffs, receivePledge } from "@/lib/services/pledges";
import { fileConcern, listConcerns, updateConcern } from "@/lib/services/concerns";
import { listInventory } from "@/lib/services/inventory";
import { listNeeds } from "@/lib/services/needs";

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

describe("an Oshawa coordinator or volunteer cannot touch London's pledges, pickups or reports", () => {
  it("covers every pledge/pickup coordinator action, with 403 or 404 and never success", () => {
    const pledgeId = w.pickupPledge();
    const drop = w.dropoffPledge(w.donor2);
    const pk = getMyPledge(w.donor, pledgeId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    const { id: concernId } = fileConcern(w.donor, { pledgeId, category: "other", details: "x" });
    setClock(new Date("2026-11-06T15:00:00Z")); // inside the visibility window: only chapter membership could stop them
    const line = getMyPledge(w.donor2, drop).items[0];

    const attempts: [string, () => unknown][] = [
      ["pickup board", () => pickupBoard(w.oshCoord, w.london.id)],
      ["assign", () => assignVolunteer(w.oshCoord, pk.id, { volunteerId: w.oshVol.id })],
      ["unassign", () => unassignVolunteer(w.oshCoord, pk.id, w.vol1.id)],
      ["confirm window", () => confirmWindow(w.oshCoord, pk.id, { windowId: pk.windows[1].id })],
      ["view address (coordinator)", () => viewPickupDetails(w.oshCoord, pk.id)],
      ["view address (volunteer)", () => viewPickupDetails(w.oshVol, pk.id)],
      ["sign up for a slot", () => signUpForSlot(w.oshVol, pk.id)],
      ["transition", () => coordinatorTransition(w.oshCoord, pledgeId, { status: "cancelled" })],
      ["receive", () => receivePledge(w.oshCoord, drop, { lines: [{ lineId: line.lineId, quantity: 6 }] })],
      ["incoming drop-offs", () => listIncomingDropoffs(w.oshCoord, w.london.id)],
      ["awaiting receipt", () => listAwaitingReceipt(w.oshCoord, w.london.id)],
      ["inventory", () => listInventory(w.oshCoord, w.london.id)],
      ["needs editor", () => listNeeds(w.oshCoord, w.london.id)],
      ["list concerns", () => listConcerns(w.oshCoord, w.london.id)],
      ["update concern", () => updateConcern(w.oshCoord, concernId, { state: "dismissed" })],
      ["file concern", () => fileConcern(w.oshVol, { pledgeId, category: "other", details: "x" })],
    ];
    for (const [name, fn] of attempts) expect([403, 404], name).toContain(status(fn));
    expect(addressAccess(w.oshCoord, pk.id)).toEqual({ allowed: false, reason: "not_related" });
    // Nothing changed.
    expect(getMyPledge(w.donor, pledgeId).status).toBe("scheduled");
    expect(getMyPledge(w.donor2, drop).status).toBe("pledged");
    // The London coordinator can, so the checks above are meaningful.
    expect(status(() => pickupBoard(w.lonCoord, w.london.id))).toBe(200);
    expect(status(() => viewPickupDetails(w.lonCoord, pk.id))).toBe(200);
  });
});
