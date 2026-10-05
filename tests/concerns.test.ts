import { beforeEach, describe, expect, it } from "vitest";
import { world, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { assignVolunteer, completePickup, arrive, confirmWindow } from "@/lib/services/pickups";
import { getMyClaim } from "@/lib/services/claims";
import { fileConcern, listConcerns, updateConcern } from "@/lib/services/concerns";
import { resetRateLimits } from "@/lib/ratelimit";
import { setClock } from "@/lib/time";

let w: World;
beforeEach(() => {
  w = world();
});
const claimNew = (who = w.neighbour, over: Record<string, unknown> = {}) => w.claimPickup(who, w.post(), over);
const dropNew = (who = w.neighbour, over: Record<string, unknown> = {}) => w.claimDropoff(who, w.post(), over);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ServiceError ? e.code : (e as Error).message;
  }
  return "no error";
};
function pickupWithTwo() {
  const claimId = claimNew();
  const pk = getMyClaim(w.neighbour, claimId).pickup!;
  assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
  assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
  confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
  return { claimId, pickupId: pk.id };
}

describe("concern reports", () => {
  it("a donor can report a concern about the volunteers, and an assigned volunteer about the donor", () => {
    const { claimId } = pickupWithTwo();
    fileConcern(w.neighbour, { claimId, category: "conduct", details: "One volunteer was rude" });
    fileConcern(w.vol1, { claimId, category: "safety", details: "Donor was aggressive" });
    const q = listConcerns(w.lonCoord, w.london.id);
    expect(q.map((r) => [r.reporterRole, r.category, r.priority])).toEqual([["volunteer", "safety", 2], ["neighbour", "conduct", 1]]); // safety first
    expect(q[0]).toMatchObject({ neighbourName: "Neighbour", volunteers: ["Vol One", "Vol Two"], state: "open" });
  });

  it("nobody else can report on a pledge (they get a 404, as for any pledge that is not theirs)", () => {
    const { claimId } = pickupWithTwo();
    for (const who of [w.stranger, w.neighbour2, w.vol3, w.oshVol, w.lonCoord]) {
      expect(code(() => fileConcern(who, { claimId, category: "other", details: "x" })), who.name).toBe("not_found");
    }
  });

  it("a donor cannot report volunteers before any are assigned", () => {
    const claimId = claimNew();
    expect(code(() => fileConcern(w.neighbour, { claimId, category: "conduct", details: "x" }))).toBe("no_volunteers_yet");
  });

  it("is rate limited, and drop-offs have no volunteers to report", () => {
    const { claimId } = pickupWithTwo();
    resetRateLimits();
    let last = "";
    for (let i = 0; i < 6; i++) last = code(() => fileConcern(w.neighbour, { claimId, category: "other", details: `n${i}` }));
    expect(last).toBe("rate_limited");
    const drop = dropNew(w.neighbour2);
    expect(code(() => fileConcern(w.neighbour2, { claimId: drop, category: "other", details: "x" }))).toBe("not_found");
  });

  it("only coordinators of the chapter see and handle the queue, and handling is audited", () => {
    const { claimId } = pickupWithTwo();
    const { id } = fileConcern(w.neighbour, { claimId, category: "no_show", details: "Nobody came" });
    expect(code(() => listConcerns(w.oshCoord, w.london.id))).toBe("forbidden");
    expect(code(() => listConcerns(w.vol1, w.london.id))).toBe("forbidden");
    expect(code(() => updateConcern(w.oshCoord, id, { state: "resolved" }))).toBe("forbidden");
    updateConcern(w.lonCoord, id, { state: "resolved", resolutionNote: "Spoke to the volunteers" });
    expect(listConcerns(w.lonCoord, w.london.id, "resolved")[0]).toMatchObject({ state: "resolved", resolutionNote: "Spoke to the volunteers" });
    expect(listConcerns(w.lonCoord, w.london.id, "open")).toEqual([]);
    expect(code(() => updateConcern(w.lonCoord, id, { state: "bogus" }))).not.toBe("no error");
  });

  it("a volunteer's safety check-out adds exactly one priority report", () => {
    const { claimId, pickupId } = pickupWithTwo();
    void claimId;
    setClock(new Date("2026-11-06T15:00:00Z"));
    arrive(w.vol1, pickupId);
    completePickup(w.vol1, pickupId, { outcome: "could_not_complete", reason: "safety_concern", note: "Dog loose in the yard" });
    expect(listConcerns(w.lonCoord, w.london.id)).toHaveLength(1);
  });
});
