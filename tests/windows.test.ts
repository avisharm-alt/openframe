import { describe, expect, it } from "vitest";
import { validateWindow, validateWindows } from "@/lib/services/windows";
import { localDate, zonedToUtc, weekStart, addDays } from "@/lib/time";

const TZ = "America/Toronto";
const NOW = new Date("2026-11-02T15:00:00Z"); // Mon 10:00 EST
const msg = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "ok";
};

describe("daytime pickup windows (09:00-20:00 local)", () => {
  it("accepts windows inside the daytime band, including the exact edges", () => {
    expect(validateWindow({ date: "2026-11-06", start: "09:00", end: "20:00" }, TZ, NOW)).toMatchObject({ startAt: "2026-11-06T14:00:00.000Z", endAt: "2026-11-07T01:00:00.000Z" });
    expect(validateWindow({ date: "2026-11-06", start: "10:30", end: "11:00" }, TZ, NOW).startAt).toBe("2026-11-06T15:30:00.000Z");
  });

  it("rejects anything starting before 09:00 or ending after 20:00 local time", () => {
    for (const [start, end] of [["08:59", "10:00"], ["06:00", "09:30"], ["19:00", "20:01"], ["20:00", "21:00"], ["22:00", "23:00"], ["00:00", "01:00"], ["19:30", "23:59"]]) {
      expect(msg(() => validateWindow({ date: "2026-11-06", start, end }, TZ, NOW)), `${start}-${end}`).toMatch(/between 9:00 a\.m\. and 8:00 p\.m\./);
    }
  });

  it("is judged in the chapter's local time, not UTC", () => {
    // 20:00 EST is 01:00 UTC the next day: still fine. 21:00 local is not, even though it looks like daytime in UTC+... terms.
    expect(msg(() => validateWindow({ date: "2026-11-06", start: "19:00", end: "20:00" }, TZ, NOW))).toBe("ok");
    expect(msg(() => validateWindow({ date: "2026-11-06", start: "14:00", end: "21:00" }, TZ, NOW))).toMatch(/between 9:00/);
    // The same wall-clock window maps to different UTC instants in another zone.
    expect(validateWindow({ date: "2026-11-06", start: "09:00", end: "10:00" }, "America/Vancouver", NOW).startAt).toBe("2026-11-06T17:00:00.000Z");
  });

  it("requires a sensible length, a future start with lead time, and at most 60 days ahead", () => {
    expect(msg(() => validateWindow({ date: "2026-11-06", start: "10:00", end: "10:20" }, TZ, NOW))).toMatch(/at least 30 minutes/);
    expect(msg(() => validateWindow({ date: "2026-11-06", start: "11:00", end: "10:00" }, TZ, NOW))).toMatch(/at least 30 minutes/);
    expect(msg(() => validateWindow({ date: "2026-11-01", start: "10:00", end: "12:00" }, TZ, NOW))).toMatch(/at least 12 hours/);
    expect(msg(() => validateWindow({ date: "2026-11-02", start: "16:00", end: "18:00" }, TZ, NOW))).toMatch(/at least 12 hours/); // 6 hours away
    expect(msg(() => validateWindow({ date: "2026-11-03", start: "09:00", end: "10:00" }, TZ, NOW))).toBe("ok"); // 23 hours away
    expect(msg(() => validateWindow({ date: "2027-03-01", start: "10:00", end: "12:00" }, TZ, NOW))).toMatch(/60 days/);
  });

  it("rejects duplicate preferred windows", () => {
    const w = { date: "2026-11-06", start: "10:00", end: "12:00" };
    expect(msg(() => validateWindows([w, { ...w, end: "13:00" }], TZ, NOW))).toMatch(/different/);
    expect(validateWindows([w, { ...w, start: "13:00", end: "14:00" }], TZ, NOW)).toHaveLength(2);
  });
});

describe("timezone helpers", () => {
  it("converts local wall time to UTC across the daylight-saving change", () => {
    expect(zonedToUtc("2026-11-01", "12:00", TZ).toISOString()).toBe("2026-11-01T17:00:00.000Z"); // EST after the fall-back
    expect(zonedToUtc("2026-10-31", "12:00", TZ).toISOString()).toBe("2026-10-31T16:00:00.000Z"); // EDT before it
    expect(zonedToUtc("2026-03-08", "12:00", TZ).toISOString()).toBe("2026-03-08T16:00:00.000Z"); // EDT after the spring-forward
  });
  it("finds local dates and ISO weeks", () => {
    expect(localDate(TZ, new Date("2026-11-03T02:30:00Z"))).toBe("2026-11-02"); // still Monday evening in Toronto
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday belongs to the week starting Monday
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});
