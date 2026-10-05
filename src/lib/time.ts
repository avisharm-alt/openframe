// Clock and timezone helpers. No dependencies, so services and tests can both use them.
// Services call nowDate() instead of new Date() so tests can move the clock with setClock().

let override: Date | null = null;
export const nowDate = () => (override ? new Date(override.getTime()) : new Date());
/** Test helper: freeze the clock at a date (or pass null to use real time). */
export function setClock(d: Date | null) {
  override = d;
}

const HOUR = 3600_000;
export const hoursFrom = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant at which the wall clock in `tz` reads `date` `time` ("YYYY-MM-DD", "HH:MM"). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - offsetMinutes(tz, new Date(naive)) * 60000;
  return new Date(naive - offsetMinutes(tz, new Date(first)) * 60000);
}

/** "YYYY-MM-DD" of `at` in `tz`. */
export function localDate(tz: string, at: Date = nowDate()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Monday of the week containing `date` (ISO weeks). */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

export const isDateString = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

/** Human-readable local time, e.g. "Sat, Nov 8, 2:30 p.m." */
export function formatLocal(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(typeof d === "string" ? new Date(d) : d);
}
