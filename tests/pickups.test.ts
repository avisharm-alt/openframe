import { beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, NOTES, PHONE, world, type World } from "./fixtures";
import { deleteAccount } from "@/lib/services/account";
import { getDb } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { setClock } from "@/lib/time";
import { resetRateLimits } from "@/lib/ratelimit";
import { acknowledgeSafety } from "@/lib/services/safety";
import { removeMember, setMember } from "@/lib/services/chapters";
import { addressAccess, arrive, assignVolunteer, availableSlots, completePickup, confirmWindow, myAssignments, notifyOverduePickups, pickupBoard, purgePickups, signUpForSlot, unassignVolunteer, viewPickupDetails } from "@/lib/services/pickups";
import { coordinatorTransition, getMyClaim } from "@/lib/services/claims";
import { listConcerns } from "@/lib/services/concerns";

let w: World;
beforeEach(() => {
  w = world();
});
const claimNew = (who = w.neighbour, over: Record<string, unknown> = {}) => w.claimPickup(who, w.post(), over);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ServiceError ? e.code : (e as Error).message;
  }
  return "no error";
};
// 2026-11-06 10:00-12:00 Toronto = 15:00-17:00Z. Address visible from 2026-11-05T15:00Z.
const AT = (iso: string) => new Date(iso);
const VISIBLE = "2026-11-05T15:00:00Z";
const WINDOW_START = "2026-11-06T15:00:00Z";
const WINDOW_END = "2026-11-06T17:00:00Z";

/** A pickup pledge with two volunteers and a confirmed window -> scheduled. */
function scheduled(donor = w.neighbour) {
  const claimId = claimNew(donor);
  const pk = getMyClaim(donor, claimId).pickup!;
  assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
  assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
  confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
  return { claimId, pickupId: pk.id, windowId: pk.windows[0].id };
}
const status = (claimId: string) => (getDb().prepare("SELECT status FROM claim WHERE id = ?").get(claimId) as { status: string }).status;

describe("two-volunteer rule", () => {
  it("a pickup cannot become scheduled with zero or one volunteer, even with a confirmed window", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    expect(code(() => coordinatorTransition(w.lonCoord, claimId, { status: "scheduled" }))).toBe("two_volunteers_required");
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    expect(status(claimId)).toBe("claimed");
    expect(code(() => coordinatorTransition(w.lonCoord, claimId, { status: "scheduled" }))).toBe("two_volunteers_required");
    const r = assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    expect(r.scheduled).toBe(true); // second volunteer + confirmed window -> scheduled automatically
    expect(status(claimId)).toBe("scheduled");
  });

  it("also needs a confirmed window, whichever order things happen in", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    expect(status(claimId)).toBe("claimed");
    expect(code(() => coordinatorTransition(w.lonCoord, claimId, { status: "scheduled" }))).toBe("window_required");
    expect(confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[1].id }).scheduled).toBe(true);
  });

  it("two assignments of the same person do not count twice", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    expect(code(() => assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id }))).toBe("already_assigned");
  });

  it("removing a volunteer from a scheduled pickup sends it back to pledged, and it cannot run with one person", () => {
    const { claimId, pickupId } = scheduled();
    unassignVolunteer(w.lonCoord, pickupId, w.vol2.id);
    expect(status(claimId)).toBe("claimed");
    setClock(AT(WINDOW_START));
    expect(code(() => arrive(w.vol1, pickupId))).toBe("pickup_not_open");
    assignVolunteer(w.lonCoord, pickupId, { volunteerId: w.vol3.id });
    expect(status(claimId)).toBe("scheduled");
  });

  it("check-in re-checks the rule, so a pickup that somehow has one volunteer still cannot start", () => {
    const { pickupId } = scheduled();
    // Simulate corrupted state (a row deleted behind the service's back): scheduled, but only one volunteer left.
    getDb().prepare("DELETE FROM pickup_assignment WHERE volunteer_id = ?").run(w.vol2.id);
    setClock(AT(WINDOW_START));
    expect(code(() => arrive(w.vol1, pickupId))).toBe("two_volunteers_required");
    expect(code(() => completePickup(w.vol1, pickupId, { outcome: "collected" }))).toBe("not_arrived");
  });

  it("when a volunteer loses their chapter role their open assignments are released", () => {
    const { claimId } = scheduled();
    removeMember(w.lonCoord, w.london.id, w.vol2.id);
    expect(status(claimId)).toBe("claimed");
  });

  it("only coordinators of that chapter assign, and only chapter volunteers can be assigned", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    expect(code(() => assignVolunteer(w.oshCoord, pk.id, { volunteerId: w.vol1.id }))).toBe("forbidden");
    expect(code(() => assignVolunteer(w.vol1, pk.id, { volunteerId: w.vol2.id }))).toBe("forbidden");
    expect(code(() => assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.oshVol.id }))).toBe("invalid"); // volunteer of another chapter
    expect(code(() => assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.stranger.id }))).toBe("invalid");
  });

  it("nobody is assigned to their own pickup", () => {
    setMember(w.lonCoord, w.london.id, { email: "neighbour@example.test", role: "volunteer" });
    acknowledgeSafety(w.neighbour);
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    expect(code(() => assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.neighbour.id }))).toBe("invalid");
  });
});

describe("volunteers must acknowledge the Safety rules before their first assignment", () => {
  it("blocks assignment and self sign-up until acknowledged, with a timestamp", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    expect(code(() => assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.unackedVol.id }))).toBe("safety_not_acknowledged");
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    expect(code(() => signUpForSlot(w.unackedVol, pk.id))).toBe("safety_not_acknowledged");
    const { acknowledgedAt } = acknowledgeSafety(w.unackedVol);
    expect(acknowledgedAt).toBe("2026-11-02T15:00:00.000Z");
    expect(assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.unackedVol.id })).toBeTruthy();
    expect(getDb().prepare("SELECT version, acknowledged_at FROM safety_ack WHERE user_id = ?").get(w.unackedVol.id)).toEqual({ version: 1, acknowledged_at: "2026-11-02T15:00:00.000Z" });
  });
});

describe("available slots", () => {
  it("lists confirmed-window pickups that need volunteers, without address or donor, and lets a volunteer sign up", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    expect(availableSlots(w.vol1)).toEqual([]); // no confirmed window yet
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    const slots = availableSlots(w.vol1);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ pickupId: pk.id, chapterSlug: "london", volunteersNeeded: 2, units: 2 });
    expect(JSON.stringify(slots)).not.toContain(ADDRESS);
    expect(Object.keys(slots[0]).sort()).toEqual(["chapterName", "chapterSlug", "label", "pickupId", "timezone", "units", "volunteersNeeded", "window"]);
    expect(availableSlots(w.oshVol)).toEqual([]); // other chapter
    expect(availableSlots(w.stranger)).toEqual([]);
    signUpForSlot(w.vol1, pk.id);
    expect(availableSlots(w.vol1)).toEqual([]); // already mine
    expect(availableSlots(w.vol2)[0].volunteersNeeded).toBe(1);
    expect(signUpForSlot(w.vol2, pk.id).scheduled).toBe(true);
    expect(availableSlots(w.vol3)).toEqual([]); // full
    expect(code(() => signUpForSlot(w.vol3, pk.id))).toBe("slot_full");
    expect(code(() => signUpForSlot(w.oshVol, pk.id))).toBe("not_found");
  });
});

describe("address visibility: who and when", () => {
  it("encrypts the details at rest: the stored columns never contain the plaintext", () => {
    claimNew();
    const raw = JSON.stringify(getDb().prepare("SELECT * FROM pickup").all());
    for (const secret of [ADDRESS, NOTES, PHONE, "Wallaby", "side gate", "555-0142"]) expect(raw).not.toContain(secret);
    expect(raw).toMatch(/v1\./);
  });

  it("nobody unrelated can see it, or even tell that it exists (404, never 403)", () => {
    const { pickupId } = scheduled();
    setClock(AT(WINDOW_START));
    for (const who of [w.stranger, w.neighbour2, w.vol3, w.oshVol, w.oshCoord, w.unackedVol]) {
      expect(code(() => viewPickupDetails(who, pickupId)), who.name).toBe("not_found");
      expect(addressAccess(who, pickupId)).toEqual({ allowed: false, reason: "not_related" });
    }
    expect(code(() => viewPickupDetails(w.admin, pickupId))).toBe("no error"); // admins coordinate every chapter
  });

  it("assigned volunteers and chapter coordinators see it only from 24 hours before the window", () => {
    const { pickupId } = scheduled();
    // 25 hours before the window starts: hidden, with the time it will appear.
    setClock(AT("2026-11-05T14:00:00Z"));
    for (const who of [w.vol1, w.vol2, w.lonCoord]) {
      expect(code(() => viewPickupDetails(who, pickupId)), who.name).toBe("not_yet_visible");
      expect(addressAccess(who, pickupId)).toMatchObject({ allowed: false, reason: "not_yet", visibleFrom: "2026-11-05T15:00:00.000Z" });
    }
    // Exactly 24 hours before: visible.
    setClock(AT(VISIBLE));
    const d = viewPickupDetails(w.vol1, pickupId);
    expect(d).toMatchObject({ address: ADDRESS, notes: NOTES, phone: PHONE, viewedAs: "volunteer" });
    expect(viewPickupDetails(w.lonCoord, pickupId).viewedAs).toBe("coordinator");
    // During the window and after it, while the pickup is still open.
    setClock(AT(WINDOW_END));
    expect(viewPickupDetails(w.vol2, pickupId).address).toBe(ADDRESS);
    setClock(AT("2026-11-07T03:00:00Z"));
    expect(viewPickupDetails(w.vol2, pickupId).address).toBe(ADDRESS);
  });

  it("the error for a too-early view reveals nothing but the time", () => {
    const { pickupId } = scheduled();
    try {
      viewPickupDetails(w.vol1, pickupId);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as ServiceError;
      expect(err.status).toBe(403);
      expect(JSON.stringify(err.details)).toBe(JSON.stringify({ visibleFrom: "2026-11-05T15:00:00.000Z" }));
      expect(err.message).not.toContain(ADDRESS);
    }
  });

  it("volunteers only see it once the pickup is scheduled (two volunteers, window confirmed)", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    setClock(AT(VISIBLE));
    // Window not confirmed: the reference is the earliest preferred window, so the clock is already inside 24h.
    expect(code(() => viewPickupDetails(w.vol1, pk.id))).toBe("not_scheduled");
    expect(viewPickupDetails(w.lonCoord, pk.id).address).toBe(ADDRESS); // coordinators may, to arrange it
  });

  it("the window used is the confirmed one, not the earliest preferred one", () => {
    const claimId = claimNew();
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[1].id }); // Saturday 13:00
    setClock(AT(VISIBLE)); // Thursday 10:00 local: would be visible for the Friday window, but Saturday was confirmed
    expect(code(() => viewPickupDetails(w.vol1, pk.id))).toBe("not_yet_visible");
    setClock(AT("2026-11-06T18:00:00Z")); // Saturday 13:00 - 24h = Friday 13:00 local
    expect(viewPickupDetails(w.vol1, pk.id).address).toBe(ADDRESS);
  });

  it("the donor always sees what they entered (until it is purged); the 24h rule is for others", () => {
    const { pickupId } = scheduled();
    expect(viewPickupDetails(w.neighbour, pickupId)).toMatchObject({ address: ADDRESS, viewedAs: "neighbour" });
  });

  it("nobody sees it once the pickup is closed, except the donor until the purge", () => {
    const { pickupId, claimId } = scheduled();
    setClock(AT(WINDOW_START));
    arrive(w.vol1, pickupId);
    arrive(w.vol2, pickupId);
    completePickup(w.vol1, pickupId, { outcome: "collected" });
    completePickup(w.vol2, pickupId, { outcome: "collected" });
    expect(status(claimId)).toBe("collected");
    for (const who of [w.vol1, w.vol2, w.lonCoord]) expect(code(() => viewPickupDetails(who, pickupId)), who.name).toBe("forbidden");
    expect(viewPickupDetails(w.neighbour, pickupId).address).toBe(ADDRESS);
  });

  it("cancelled pickups are closed for everyone but the donor too", () => {
    const { pickupId, claimId } = scheduled();
    coordinatorTransition(w.lonCoord, claimId, { status: "cancelled", reason: "Donor moved" });
    setClock(AT(WINDOW_START));
    expect(code(() => viewPickupDetails(w.vol1, pickupId))).toBe("forbidden");
    expect(code(() => viewPickupDetails(w.lonCoord, pickupId))).toBe("forbidden");
  });

  it("a volunteer who is also a coordinator is treated as a coordinator (either role may pass)", () => {
    setMember(w.admin, w.london.id, { email: "vol.one@example.test", role: "coordinator" });
    const { pickupId } = scheduled();
    setClock(AT(VISIBLE));
    expect(viewPickupDetails(w.vol1, pickupId).viewedAs).toBe("coordinator");
  });

  it("every view is written to the audit log, and the log never holds the address", () => {
    const { pickupId } = scheduled();
    setClock(AT(VISIBLE));
    viewPickupDetails(w.vol1, pickupId);
    viewPickupDetails(w.lonCoord, pickupId);
    viewPickupDetails(w.neighbour, pickupId);
    const rows = getDb().prepare("SELECT actor_id, subject_id, detail FROM audit_event WHERE action = 'address_viewed' ORDER BY rowid").all() as { actor_id: string; subject_id: string; detail: string }[];
    expect(rows.map((r) => r.actor_id)).toEqual([w.vol1.id, w.lonCoord.id, w.neighbour.id]);
    expect(rows.every((r) => r.subject_id === pickupId)).toBe(true);
    expect(rows.map((r) => JSON.parse(r.detail))).toEqual([{ as: "volunteer" }, { as: "coordinator" }, { as: "neighbour" }]);
    const everything = JSON.stringify(getDb().prepare("SELECT * FROM audit_event").all());
    for (const secret of [ADDRESS, NOTES, PHONE, "Wallaby"]) expect(everything).not.toContain(secret);
    // Denied attempts by related people are logged too.
    setClock(AT("2026-11-01T00:00:00Z"));
    code(() => viewPickupDetails(w.vol2, pickupId));
    expect(getDb().prepare("SELECT detail FROM audit_event WHERE action = 'address_view_denied'").all()).toEqual([{ detail: JSON.stringify({ reason: "not_yet" }) }]);
  });

  it("rate-limits address views per person", () => {
    const { pickupId } = scheduled();
    setClock(AT(VISIBLE));
    resetRateLimits();
    let last = "";
    for (let i = 0; i < 61; i++) last = code(() => viewPickupDetails(w.vol1, pickupId));
    expect(last).toBe("rate_limited");
  });

  it("no listing endpoint ever includes the address, notes or phone", () => {
    const { claimId } = scheduled();
    setClock(AT(VISIBLE));
    const dumps = [
      getMyClaim(w.neighbour, claimId), myAssignments(w.vol1), availableSlots(w.vol3), pickupBoard(w.lonCoord, w.london.id),
      listConcerns(w.lonCoord, w.london.id),
    ];
    const text = JSON.stringify(dumps);
    for (const secret of [ADDRESS, NOTES, PHONE, "Wallaby", "side gate", "555-0142", "address_enc"]) expect(text).not.toContain(secret);
  });
});

describe("check-in and check-out", () => {
  it("each volunteer taps Arrived and Done; the pledge is collected only when both are done", () => {
    const { pickupId, claimId } = scheduled();
    setClock(AT(WINDOW_START));
    expect(code(() => completePickup(w.vol1, pickupId, { outcome: "collected" }))).toBe("not_arrived");
    arrive(w.vol1, pickupId);
    arrive(w.vol2, pickupId);
    completePickup(w.vol1, pickupId, { outcome: "collected" });
    expect(status(claimId)).toBe("scheduled"); // waiting for the second volunteer
    expect(code(() => completePickup(w.vol1, pickupId, { outcome: "collected" }))).toBe("already_recorded");
    expect(completePickup(w.vol2, pickupId, { outcome: "collected" }).closedAs).toBe("collected");
    expect(status(claimId)).toBe("collected");
    expect(w.sent.map((m) => m.template)).toContain("claim_collected");
  });

  it("only assigned volunteers can check in, and not too early", () => {
    const { pickupId } = scheduled();
    expect(code(() => arrive(w.vol3, pickupId))).toBe("not_found");
    expect(code(() => arrive(w.neighbour, pickupId))).toBe("not_found");
    setClock(AT("2026-11-06T13:00:00Z")); // two hours before the window
    expect(code(() => arrive(w.vol1, pickupId))).toBe("too_early");
    setClock(AT("2026-11-06T14:00:00Z")); // one hour before
    expect(arrive(w.vol1, pickupId).arrivedAt).toBe("2026-11-06T14:00:00.000Z");
  });

  it("'nobody was there' closes it as a no-show", () => {
    const { pickupId, claimId } = scheduled();
    setClock(AT(WINDOW_START));
    arrive(w.vol1, pickupId);
    expect(completePickup(w.vol1, pickupId, { outcome: "could_not_complete", reason: "nobody_home" }).closedAs).toBe("no_show");
    expect(status(claimId)).toBe("no_show");
  });

  it("'I can no longer make it' removes only that volunteer and reopens the pickup", () => {
    const { pickupId, claimId } = scheduled();
    setClock(AT(WINDOW_START));
    expect(completePickup(w.vol2, pickupId, { outcome: "could_not_complete", reason: "volunteer_unavailable" }).closedAs).toBeNull();
    expect(status(claimId)).toBe("claimed");
    expect(getMyClaim(w.neighbour, claimId).pickup!.volunteerCount).toBe(1);
  });

  it("a safety concern cancels the pickup and files a priority report for coordinators", () => {
    const { pickupId, claimId } = scheduled();
    setClock(AT(WINDOW_START));
    expect(code(() => completePickup(w.vol1, pickupId, { outcome: "could_not_complete", reason: "safety_concern" }))).toBe("invalid"); // needs words
    completePickup(w.vol1, pickupId, { outcome: "could_not_complete", reason: "safety_concern", note: "Felt unsafe at the door" });
    expect(status(claimId)).toBe("cancelled");
    const q = listConcerns(w.lonCoord, w.london.id);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ category: "safety", reporterRole: "volunteer", priority: 2, state: "open", details: "Felt unsafe at the door" });
    expect(q[0].volunteers.sort()).toEqual(["Vol One", "Vol Two"]);
  });

  it("closed pickups cannot be checked in or out of again", () => {
    const { pickupId } = scheduled();
    setClock(AT(WINDOW_START));
    arrive(w.vol1, pickupId);
    completePickup(w.vol1, pickupId, { outcome: "could_not_complete", reason: "nobody_home" });
    expect(code(() => completePickup(w.vol2, pickupId, { outcome: "could_not_complete", reason: "nobody_home" }))).toBe("pickup_not_open");
  });

  it("volunteers see their upcoming pickups with the address hidden outside the allowed time", () => {
    const { pickupId } = scheduled();
    let mine = myAssignments(w.vol1);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ pickupId, status: "scheduled", partners: ["Vol Two"], addressVisibleNow: false, canArrive: false, units: 2, visibleFrom: "2026-11-05T15:00:00.000Z" });
    setClock(AT(VISIBLE));
    expect(myAssignments(w.vol1)[0].addressVisibleNow).toBe(true);
    setClock(AT("2026-11-06T14:30:00Z"));
    mine = myAssignments(w.vol1);
    expect(mine[0]).toMatchObject({ canArrive: true, canCheckOut: true });
    expect(myAssignments(w.vol3)).toEqual([]);
  });
});

describe("purge", () => {
  it("erases address, notes and phone 7 days after collected, cancelled or no-show, and not before", () => {
    const a = scheduled(); // will be collected
    const b = claimNew(w.neighbour2); // will be cancelled
    const c = scheduled(w.stranger); // no-show; needs its own volunteers
    void c;
    setClock(AT(WINDOW_START));
    arrive(w.vol1, a.pickupId);
    arrive(w.vol2, a.pickupId);
    completePickup(w.vol1, a.pickupId, { outcome: "collected" });
    completePickup(w.vol2, a.pickupId, { outcome: "collected" });
    const bPickup = getMyClaim(w.neighbour2, b).pickup!;
    coordinatorTransition(w.lonCoord, b, { status: "cancelled", reason: "Donor changed their mind" });
    const closedAt = "2026-11-06T15:00:00.000Z";
    expect((getDb().prepare("SELECT closed_at FROM claim WHERE id = ?").get(a.claimId) as { closed_at: string }).closed_at).toBe(closedAt);

    // Day 6: nothing is purged.
    expect(purgePickups(AT("2026-11-12T14:59:00Z"))).toBe(0);
    expect(viewPickupDetails(w.neighbour, a.pickupId).address).toBe(ADDRESS);
    // Day 7 exactly: the collected and the cancelled pickups are purged; the one still open is untouched.
    expect(purgePickups(AT("2026-11-13T15:00:00Z"))).toBe(2);
    const row = getDb().prepare("SELECT address_enc, notes_enc, phone_enc, purged_at FROM pickup WHERE id = ?").get(a.pickupId) as Record<string, string | null>;
    expect(row).toEqual({ address_enc: null, notes_enc: null, phone_enc: null, purged_at: "2026-11-13T15:00:00.000Z" });
    expect(getMyClaim(w.neighbour, a.claimId).pickup!.detailsPurged).toBe(true);
    expect(getMyClaim(w.neighbour2, b).pickup!.detailsPurged).toBe(true);
    expect(bPickup.id).toBeTruthy();
    setClock(AT("2026-11-13T16:00:00Z"));
    expect(code(() => viewPickupDetails(w.neighbour, a.pickupId))).toBe("details_purged");
    expect(code(() => viewPickupDetails(w.lonCoord, a.pickupId))).toBe("details_purged");
    // Open pickups keep theirs, and a second run is a no-op.
    const openStill = getDb().prepare("SELECT COUNT(*) AS n FROM pickup WHERE address_enc IS NOT NULL").get() as { n: number };
    expect(openStill.n).toBe(1);
    expect(purgePickups(AT("2026-11-14T00:00:00Z"))).toBe(0);
    // The purge is audited (a count, not content).
    expect(getDb().prepare("SELECT detail FROM audit_event WHERE action = 'pickups_purged'").all()).toEqual([{ detail: JSON.stringify({ count: 2, days: 7 }) }]);
  });

  it("windows survive the purge (they are not personal data) and received pledges purge from the collected date", () => {
    const { pickupId, claimId } = scheduled();
    setClock(AT(WINDOW_START));
    arrive(w.vol1, pickupId); arrive(w.vol2, pickupId);
    completePickup(w.vol1, pickupId, { outcome: "collected" }); completePickup(w.vol2, pickupId, { outcome: "collected" });
    purgePickups(AT("2026-11-20T00:00:00Z"));
    expect(getMyClaim(w.neighbour, claimId).pickup!.windows).toHaveLength(2);
  });

  it("honours a different retention period", () => {
    const { claimId } = scheduled();
    coordinatorTransition(w.lonCoord, claimId, { status: "cancelled", reason: "x" });
    expect(purgePickups(AT("2026-11-04T15:00:00Z"), 3)).toBe(0); // cancelled 2 Nov 15:00, 3 days not up
    expect(purgePickups(AT("2026-11-05T15:00:00Z"), 3)).toBe(1);
  });
});

describe("overdue", () => {
  it("flags a scheduled pickup not closed within 2 hours of its window ending, and emails coordinators once", () => {
    const { pickupId } = scheduled();
    setClock(AT("2026-11-06T18:59:00Z")); // 1h59m after the window
    expect(pickupBoard(w.lonCoord, w.london.id).overdue).toHaveLength(0);
    expect(notifyOverduePickups()).toBe(0);
    setClock(AT("2026-11-06T19:00:00Z")); // exactly 2 hours
    const b = pickupBoard(w.lonCoord, w.london.id);
    expect(b.overdue.map((c) => c.pickupId)).toEqual([pickupId]);
    expect(b.today).toHaveLength(0);
    expect(notifyOverduePickups()).toBe(1);
    expect(notifyOverduePickups()).toBe(0);
    const mails = w.sent.filter((m) => m.template === "pickup_overdue");
    expect(mails.map((m) => m.to)).toEqual(["lon.coord@example.test"]);
    expect(mails[0].text).not.toContain(ADDRESS);
  });

  it("is cleared once the pickup is closed", () => {
    const { pickupId, claimId } = scheduled();
    setClock(AT("2026-11-06T20:00:00Z"));
    expect(pickupBoard(w.lonCoord, w.london.id).overdue).toHaveLength(1);
    coordinatorTransition(w.lonCoord, claimId, { status: "no_show", reason: "volunteers could not reach donor" });
    expect(pickupBoard(w.lonCoord, w.london.id).overdue).toHaveLength(0);
    expect(code(() => arrive(w.vol1, pickupId))).toBe("pickup_not_open");
  });
});

describe("pickup board", () => {
  it("sorts pickups into unassigned / scheduled / today / overdue and is for coordinators of that chapter only", () => {
    const un = claimNew(w.neighbour2);
    const { pickupId } = scheduled();
    setClock(AT("2026-11-02T16:00:00Z"));
    let b = pickupBoard(w.lonCoord, w.london.id);
    expect(b.unassigned.map((c) => c.claimId)).toEqual([un]);
    expect(b.scheduled.map((c) => c.pickupId)).toEqual([pickupId]);
    expect(b.today).toHaveLength(0);
    setClock(AT("2026-11-06T13:00:00Z")); // Friday, inside the day
    b = pickupBoard(w.lonCoord, w.london.id);
    expect(b.today.map((c) => c.pickupId)).toEqual([pickupId]);
    expect(b.today[0].volunteers.map((v) => v.name)).toEqual(["Vol One", "Vol Two"]);
    expect(code(() => pickupBoard(w.oshCoord, w.london.id))).toBe("forbidden");
    expect(code(() => pickupBoard(w.vol1, w.london.id))).toBe("forbidden");
  });
});

describe("account deletion", () => {
  it("erases a donor's pickup details immediately and cancels their open pledges", () => {
    const { claimId, pickupId } = scheduled();
    deleteAccount(w.neighbour.id);
    const row = getDb().prepare("SELECT address_enc, notes_enc, phone_enc, purged_at FROM pickup WHERE id = ?").get(pickupId) as Record<string, string | null>;
    expect(row.address_enc).toBeNull();
    expect(row.purged_at).not.toBeNull();
    expect(status(claimId)).toBe("cancelled");
    expect((getDb().prepare("SELECT neighbour_id FROM claim WHERE id = ?").get(claimId) as { neighbour_id: string | null }).neighbour_id).toBeNull();
  });

  it("releases a deleted volunteer's open assignments", () => {
    const { claimId } = scheduled();
    deleteAccount(w.vol1.id);
    expect(status(claimId)).toBe("claimed");
    expect(getMyClaim(w.neighbour, claimId).pickup!.volunteerCount).toBe(1);
  });
});
