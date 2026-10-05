import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { world, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { setClock } from "@/lib/time";
import { cancelShiftSignup, coverage, createPeriod, createSlot, deletePeriod, listCoverage, myShifts, onShift, openShifts, sendShiftReminders, signUpShift, updateSlot, weekdayOf } from "@/lib/services/shifts";
import { pickupBoard, assignVolunteer } from "@/lib/services/pickups";
import { sweep } from "@/lib/services/sweep";
import { makeUser } from "./helpers";

let w: World;
let tue: string; // slot id: Tuesday 16:00-18:00, needs 2
beforeEach(() => {
  w = world();
  tue = createSlot(w.lonCoord, w.london.id, { label: "Tuesday pickups and delivery", weekday: 1, start: "16:00", end: "18:00", needed: 2 }).id;
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
// NOW is Monday 2 Nov 2026. The next Tuesdays are 3, 10, 17, 24 Nov.

describe("weekly shift slots", () => {
  it("are defined by coordinators of the chapter only, with sane times", () => {
    expect(weekdayOf("2026-11-03")).toBe(1);
    expect(weekdayOf("2026-11-08")).toBe(6);
    expect(code(() => createSlot(w.oshCoord, w.london.id, { label: "x", weekday: 2, start: "10:00", end: "12:00", needed: 2 }))).toBe("forbidden");
    expect(code(() => createSlot(w.vol1, w.london.id, { label: "x", weekday: 2, start: "10:00", end: "12:00", needed: 2 }))).toBe("forbidden");
    expect(code(() => createSlot(w.lonCoord, w.london.id, { label: "x", weekday: 2, start: "12:00", end: "10:00", needed: 2 }))).toBe("invalid");
    expect(code(() => createSlot(w.lonCoord, w.london.id, { label: "x", weekday: 9, start: "10:00", end: "12:00", needed: 2 }))).toBe("invalid");
    expect(updateSlot(w.lonCoord, tue, { needed: 3 }).needed).toBe(3);
    expect(code(() => updateSlot(w.oshCoord, tue, { needed: 1 }))).toBe("forbidden");
  });
});

describe("signing up and coverage", () => {
  it("volunteers sign up for dated occurrences; coordinators see coverage and the gaps", () => {
    signUpShift(w.vol1, tue, { date: "2026-11-03" });
    signUpShift(w.vol2, tue, { date: "2026-11-03" });
    signUpShift(w.vol1, tue, { date: "2026-11-10" });
    const cov = listCoverage(w.lonCoord, w.london.id, 3);
    expect(cov.map((o) => [o.date, o.signedUp.length, o.gap])).toEqual([["2026-11-03", 2, 0], ["2026-11-10", 1, 1], ["2026-11-17", 0, 2]]);
    expect(cov[0].signedUp.map((s) => s.name)).toEqual(["Vol One", "Vol Two"]);
    expect(code(() => listCoverage(w.vol1, w.london.id))).toBe("forbidden");
    expect(code(() => listCoverage(w.oshCoord, w.london.id))).toBe("forbidden");
  });

  it("checks the date, the role and the Safety acknowledgement, and does not over-book", () => {
    expect(code(() => signUpShift(w.vol1, tue, { date: "2026-11-04" }))).toBe("invalid"); // a Wednesday
    expect(code(() => signUpShift(w.vol1, tue, { date: "2026-10-27" }))).toBe("invalid"); // past
    expect(code(() => signUpShift(w.vol1, tue, { date: "2027-03-02" }))).toBe("invalid"); // too far ahead
    expect(code(() => signUpShift(w.neighbour, tue, { date: "2026-11-03" }))).toBe("not_found"); // not a volunteer
    expect(code(() => signUpShift(w.oshVol, tue, { date: "2026-11-03" }))).toBe("not_found"); // other chapter
    expect(code(() => signUpShift(w.unackedVol, tue, { date: "2026-11-03" }))).toBe("safety_not_acknowledged");
    signUpShift(w.vol1, tue, { date: "2026-11-03" });
    expect(code(() => signUpShift(w.vol1, tue, { date: "2026-11-03" }))).toBe("already_signed_up");
    signUpShift(w.vol2, tue, { date: "2026-11-03" });
    expect(code(() => signUpShift(w.vol3, tue, { date: "2026-11-03" }))).toBe("shift_full");
  });

  it("lists open shifts for a volunteer's chapters, and my shifts, and lets them cancel", () => {
    signUpShift(w.vol1, tue, { date: "2026-11-03" });
    expect(openShifts(w.vol1).map((o) => o.date)).not.toContain("2026-11-03"); // already mine
    expect(openShifts(w.vol2).map((o) => o.date)).toContain("2026-11-03");
    expect(openShifts(w.oshVol)).toEqual([]);
    expect(myShifts(w.vol1)).toMatchObject([{ label: "Tuesday pickups and delivery", date: "2026-11-03", start: "16:00", end: "18:00", chapterSlug: "london" }]);
    cancelShiftSignup(w.vol1, tue, "2026-11-03");
    expect(myShifts(w.vol1)).toEqual([]);
    expect(code(() => cancelShiftSignup(w.vol1, tue, "2026-11-03"))).toBe("not_found");
  });
});

describe("exam-period coverage planning", () => {
  it("adds a buffer of extra volunteers to each slot during the period, shown as gaps", () => {
    createPeriod(w.lonCoord, w.london.id, { label: "December exams", startDate: "2026-11-10", endDate: "2026-11-24", extraNeeded: 1 });
    signUpShift(w.vol1, tue, { date: "2026-11-10" });
    signUpShift(w.vol2, tue, { date: "2026-11-10" });
    const cov = coverage(w.london.id, 4);
    const by = Object.fromEntries(cov.map((o) => [o.date, o]));
    expect(by["2026-11-03"]).toMatchObject({ boost: 0, periodLabel: null, gap: 2 });
    expect(by["2026-11-10"]).toMatchObject({ boost: 1, periodLabel: "December exams", gap: 1 }); // 3 wanted, 2 signed up
    expect(by["2026-11-17"]).toMatchObject({ boost: 1, gap: 3 });
    expect(by["2026-11-24"]).toMatchObject({ boost: 1 });
    signUpShift(w.vol3, tue, { date: "2026-11-10" }); // the buffer can be filled
    expect(code(() => createPeriod(w.oshCoord, w.london.id, { label: "x", startDate: "2026-11-10", endDate: "2026-11-11", extraNeeded: 1 }))).toBe("forbidden");
    expect(code(() => createPeriod(w.lonCoord, w.london.id, { label: "x", startDate: "2026-11-12", endDate: "2026-11-11", extraNeeded: 1 }))).toBe("invalid");
    const id = (w.db.prepare("SELECT id FROM shift_period").get() as { id: string }).id;
    expect(code(() => deletePeriod(w.oshCoord, id))).toBe("forbidden");
    deletePeriod(w.lonCoord, id);
    expect(coverage(w.london.id, 3).find((o) => o.date === "2026-11-10")!.boost).toBe(0);
  });
});

describe("suggestions for pickups on the matching shift", () => {
  it("suggests the volunteers on the shift that overlaps a pickup window, who are not already assigned", () => {
    // A pickup window on Tuesday 10 Nov 16:30-17:30 Toronto.
    const c = w.claimPickup(w.neighbour, w.post({ neededBy: "2026-11-12" }), { windows: [{ date: "2026-11-10", start: "16:30", end: "17:30" }] });
    signUpShift(w.vol1, tue, { date: "2026-11-10" });
    signUpShift(w.vol3, tue, { date: "2026-11-10" });
    const board = () => pickupBoard(w.lonCoord, w.london.id).unassigned[0];
    expect(board().suggested.map((s) => s.name).sort()).toEqual(["Vol One", "Vol Three"]);
    assignVolunteer(w.lonCoord, w.pickupOf(w.neighbour, c).id, { volunteerId: w.vol1.id });
    expect(board().suggested.map((s) => s.name)).toEqual(["Vol Three"]);
    // A window outside the shift gets no suggestion.
    const c2 = w.claimPickup(w.neighbour2, w.post({ neededBy: "2026-11-12" }), { windows: [{ date: "2026-11-10", start: "09:00", end: "11:00" }] });
    expect(pickupBoard(w.lonCoord, w.london.id).unassigned.find((x) => x.claimId === c2)!.suggested).toEqual([]);
  });

  it("onShift is based on the chapter's local time", () => {
    signUpShift(w.vol1, tue, { date: "2026-11-03" });
    const start = new Date("2026-11-03T21:30:00Z"); // 16:30 EST
    expect(onShift(w.london.id, start, new Date(start.getTime() + 3600_000))).toEqual([w.vol1.id]);
    const late = new Date("2026-11-03T23:30:00Z"); // 18:30 EST, after the shift
    expect(onShift(w.london.id, late, new Date(late.getTime() + 3600_000))).toEqual([]);
  });
});

describe("shift reminders", () => {
  it("emails each volunteer once, within 24 hours before the shift, from the sweep job", () => {
    signUpShift(w.vol1, tue, { date: "2026-11-03" });
    setClock(new Date("2026-11-02T20:00:00Z")); // 25h before 16:00 EST (21:00Z next day)
    expect(sendShiftReminders()).toBe(0);
    setClock(new Date("2026-11-02T22:00:00Z")); // 23h before
    expect(sweep().reminders).toBe(1);
    expect(sendShiftReminders()).toBe(0); // once
    const mail = w.sent.filter((m) => m.template === "shift_reminder");
    expect(mail.map((m) => m.to)).toEqual(["vol.one@example.test"]);
    expect(mail[0].text).toMatch(/Tuesday pickups and delivery/);
  });
  it("does not remind about a shift that already started", () => {
    signUpShift(w.vol1, tue, { date: "2026-11-03" });
    setClock(new Date("2026-11-03T22:30:00Z"));
    expect(sendShiftReminders()).toBe(0);
  });
});

describe("account deletion", () => {
  it("removes a deleted volunteer's sign-ups", async () => {
    const v = makeUser(w.db, "Temp Vol");
    const { setMember } = await import("@/lib/services/chapters");
    const { acknowledgeSafety } = await import("@/lib/services/safety");
    const { deleteAccount } = await import("@/lib/services/account");
    setMember(w.lonCoord, w.london.id, { email: "temp.vol@example.test", role: "volunteer" });
    acknowledgeSafety(v);
    signUpShift(v, tue, { date: "2026-11-03" });
    deleteAccount(v.id);
    expect(coverage(w.london.id, 1)[0].signedUp).toEqual([]);
  });
});
