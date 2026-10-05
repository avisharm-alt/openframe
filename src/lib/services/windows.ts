import { invalid } from "../errors";
import { WINDOW_EARLIEST, WINDOW_LATEST } from "../types";
import { addDays, hoursFrom, localDate, nowDate, zonedToUtc } from "../time";

export const MIN_LEAD_HOURS = 12; // a window must start at least this far ahead, so volunteers can be found
export const MAX_DAYS_AHEAD = 60;
export const MIN_WINDOW_MINUTES = 30;

export type WindowInput = { date: string; start: string; end: string };
export type ValidWindow = WindowInput & { startAt: string; endAt: string };

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Pickup windows are daytime only: they must start no earlier than 09:00 and end no later than 20:00 in the
 * chapter's local time, last at least 30 minutes, and fall within the next 60 days (but not sooner than 12 hours
 * from now). Returns the same window with its UTC instants.
 */
export function validateWindow(w: WindowInput, timezone: string, at: Date = nowDate()): ValidWindow {
  if (w.start < WINDOW_EARLIEST || w.end > WINDOW_LATEST) {
    throw invalid("Pickup windows must be between 9:00 a.m. and 8:00 p.m. local time. Volunteers only do daytime pickups.");
  }
  if (minutes(w.end) - minutes(w.start) < MIN_WINDOW_MINUTES) throw invalid("A pickup window must be at least 30 minutes long, and must end after it starts.");
  const today = localDate(timezone, at);
  if (w.date > addDays(today, MAX_DAYS_AHEAD)) throw invalid("Choose a date within the next 60 days.");
  const startAt = zonedToUtc(w.date, w.start, timezone);
  const endAt = zonedToUtc(w.date, w.end, timezone);
  if (w.date < today || startAt < hoursFrom(at, MIN_LEAD_HOURS)) throw invalid("Pickup windows must start at least 12 hours from now.");
  return { ...w, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

export function validateWindows(list: WindowInput[], timezone: string, at: Date = nowDate()): ValidWindow[] {
  const out = list.map((w) => validateWindow(w, timezone, at));
  const seen = new Set<string>();
  for (const w of out) {
    const k = `${w.date}T${w.start}`;
    if (seen.has(k)) throw invalid("Each preferred window must be different.");
    seen.add(k);
  }
  return out;
}
