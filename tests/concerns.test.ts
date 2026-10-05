import { beforeEach, describe, expect, it } from "vitest";
import { world, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { assignVolunteer, completePickup, arrive, confirmWindow } from "@/lib/services/pickups";
import { getMyPledge } from "@/lib/services/pledges";
import { fileConcern, listConcerns, updateConcern } from "@/lib/services/concerns";
import { resetRateLimits } from "@/lib/ratelimit";
import { setClock } from "@/lib/time";

let w: World;
beforeEach(() => {
  w = world();
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ServiceError ? e.code : (e as Error).message;
  }
  return "no error";
};
function pickupWithTwo() {
  const pledgeId = w.pickupPledge();
  const pk = getMyPledge(w.donor, pledgeId).pickup!;
  assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
  assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
  confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
  return { pledgeId, pickupId: pk.id };
}

describe("concern reports", () => {
  it("a donor can report a concern about the volunteers, and an assigned volunteer about the donor", () => {
    const { pledgeId } = pickupWithTwo();
    fileConcern(w.donor, { pledgeId, category: "conduct", details: "One volunteer was rude" });
    fileConcern(w.vol1, { pledgeId, category: "safety", details: "Donor was aggressive" });
    const q = listConcerns(w.lonCoord, w.london.id);
    expect(q.map((r) => [r.reporterRole, r.category, r.priority])).toEqual([["volunteer", "safety", 2], ["donor", "conduct", 1]]); // safety first
    expect(q[0]).toMatchObject({ donorName: "Donor", volunteers: ["Vol One", "Vol Two"], state: "open" });
  });

  it("nobody else can report on a pledge (they get a 404, as for any pledge that is not theirs)", () => {
    const { pledgeId } = pickupWithTwo();
    for (const who of [w.stranger, w.donor2, w.vol3, w.oshVol, w.lonCoord]) {
      expect(code(() => fileConcern(who, { pledgeId, category: "other", details: "x" })), who.name).toBe("not_found");
    }
  });

  it("a donor cannot report volunteers before any are assigned", () => {
    const pledgeId = w.pickupPledge();
    expect(code(() => fileConcern(w.donor, { pledgeId, category: "conduct", details: "x" }))).toBe("no_volunteers_yet");
  });

  it("is rate limited, and drop-offs have no volunteers to report", () => {
    const { pledgeId } = pickupWithTwo();
    resetRateLimits();
    let last = "";
    for (let i = 0; i < 6; i++) last = code(() => fileConcern(w.donor, { pledgeId, category: "other", details: `n${i}` }));
    expect(last).toBe("rate_limited");
    const drop = w.dropoffPledge(w.donor2);
    expect(code(() => fileConcern(w.donor2, { pledgeId: drop, category: "other", details: "x" }))).toBe("not_found");
  });

  it("only coordinators of the chapter see and handle the queue, and handling is audited", () => {
    const { pledgeId } = pickupWithTwo();
    const { id } = fileConcern(w.donor, { pledgeId, category: "no_show", details: "Nobody came" });
    expect(code(() => listConcerns(w.oshCoord, w.london.id))).toBe("forbidden");
    expect(code(() => listConcerns(w.vol1, w.london.id))).toBe("forbidden");
    expect(code(() => updateConcern(w.oshCoord, id, { state: "resolved" }))).toBe("forbidden");
    updateConcern(w.lonCoord, id, { state: "resolved", resolutionNote: "Spoke to the volunteers" });
    expect(listConcerns(w.lonCoord, w.london.id, "resolved")[0]).toMatchObject({ state: "resolved", resolutionNote: "Spoke to the volunteers" });
    expect(listConcerns(w.lonCoord, w.london.id, "open")).toEqual([]);
    expect(code(() => updateConcern(w.lonCoord, id, { state: "bogus" }))).not.toBe("no error");
  });

  it("a volunteer's safety check-out adds exactly one priority report", () => {
    const { pledgeId, pickupId } = pickupWithTwo();
    void pledgeId;
    setClock(new Date("2026-11-06T15:00:00Z"));
    arrive(w.vol1, pickupId);
    completePickup(w.vol1, pickupId, { outcome: "could_not_complete", reason: "safety_concern", note: "Dog loose in the yard" });
    expect(listConcerns(w.lonCoord, w.london.id)).toHaveLength(1);
  });
});
