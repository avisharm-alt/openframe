import { getDb, now, uid } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { addDays, hoursFrom, localDate, nowDate, zonedToUtc } from "../time";
import { periodSchema, signupSchema, slotPatchSchema, slotSchema } from "../validation";
import type { Actor } from "../types";
import { logAudit } from "./audit";
import { getChapter, isVolunteerOf, requireCoordinator } from "./access";
import { notifyShiftReminder } from "./notifications";
import { safetyAcknowledgedAt } from "./safety";

// Weekly shifts. A slot recurs every week (weekday 0 = Monday, e.g. "Tue 16:00-18:00, pickups and delivery"). Volunteers sign
// up for dated occurrences. Pickups and deliveries are suggested for the volunteers on the matching shift.

export const SIGNUP_WEEKS = 8;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type Slot = { id: string; chapterId: string; label: string; weekday: number; start: string; end: string; needed: number; active: boolean };
type SRow = { id: string; chapter_id: string; label: string; weekday: number; start_time: string; end_time: string; needed: number; active: number };
const toSlot = (r: SRow): Slot => ({ id: r.id, chapterId: r.chapter_id, label: r.label, weekday: r.weekday, start: r.start_time, end: r.end_time, needed: r.needed, active: !!r.active });
export function getSlot(id: string): Slot {
  const r = getDb().prepare("SELECT * FROM shift_slot WHERE id = ?").get(id) as SRow | undefined;
  if (!r) throw notFound("Shift not found");
  return toSlot(r);
}
export function listSlots(chapterId: string, opts: { activeOnly?: boolean } = {}): Slot[] {
  return (getDb().prepare(`SELECT * FROM shift_slot WHERE chapter_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY weekday, start_time`).all(chapterId) as SRow[]).map(toSlot);
}

export const weekdayOf = (date: string) => (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;

function checkTimes(start: string, end: string) {
  if (end <= start) throw invalid("A shift must end after it starts.");
}

export function createSlot(actor: Actor, chapterId: string, raw: unknown): Slot {
  requireCoordinator(actor, chapterId);
  const input = slotSchema.parse(raw);
  checkTimes(input.start, input.end);
  const id = uid();
  getDb().prepare("INSERT INTO shift_slot (id, chapter_id, label, weekday, start_time, end_time, needed, active, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, chapterId, input.label, input.weekday, input.start, input.end, input.needed, input.active ? 1 : 0, now());
  logAudit(actor.id, "shift_slot_created", { chapterId, subjectType: "shift", subjectId: id });
  return getSlot(id);
}
export function updateSlot(actor: Actor, slotId: string, raw: unknown): Slot {
  const s = getSlot(slotId);
  requireCoordinator(actor, s.chapterId);
  const p = slotPatchSchema.parse(raw);
  const next = { ...s, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Slot;
  checkTimes(next.start, next.end);
  getDb().prepare("UPDATE shift_slot SET label = ?, weekday = ?, start_time = ?, end_time = ?, needed = ?, active = ? WHERE id = ?").run(next.label, next.weekday, next.start, next.end, next.needed, next.active ? 1 : 0, slotId);
  logAudit(actor.id, "shift_slot_updated", { chapterId: s.chapterId, subjectType: "shift", subjectId: slotId });
  return getSlot(slotId);
}

// ---- exam periods ------------------------------------------------------------------------------------------------------------------
export type Period = { id: string; label: string; startDate: string; endDate: string; extraNeeded: number };
export function listPeriods(chapterId: string): Period[] {
  return getDb().prepare("SELECT id, label, start_date AS startDate, end_date AS endDate, extra_needed AS extraNeeded FROM shift_period WHERE chapter_id = ? ORDER BY start_date").all(chapterId) as Period[];
}
/** Plan exam-period (or holiday) coverage: extra volunteers to line up per slot, as a buffer for absences. */
export function createPeriod(actor: Actor, chapterId: string, raw: unknown): { id: string } {
  requireCoordinator(actor, chapterId);
  const input = periodSchema.parse(raw);
  if (input.endDate < input.startDate) throw invalid("The period must end on or after it starts.");
  const id = uid();
  getDb().prepare("INSERT INTO shift_period (id, chapter_id, label, start_date, end_date, extra_needed, created_at) VALUES (?,?,?,?,?,?,?)").run(id, chapterId, input.label, input.startDate, input.endDate, input.extraNeeded, now());
  logAudit(actor.id, "shift_period_created", { chapterId, subjectType: "shift_period", subjectId: id });
  return { id };
}
export function deletePeriod(actor: Actor, periodId: string) {
  const p = getDb().prepare("SELECT chapter_id AS chapterId FROM shift_period WHERE id = ?").get(periodId) as { chapterId: string } | undefined;
  if (!p) throw notFound("Period not found");
  requireCoordinator(actor, p.chapterId);
  getDb().prepare("DELETE FROM shift_period WHERE id = ?").run(periodId);
}

// ---- coverage ------------------------------------------------------------------------------------------------------------------------
export type Occurrence = { slotId: string; label: string; date: string; start: string; end: string; needed: number; boost: number; periodLabel: string | null; signedUp: { id: string; name: string }[]; gap: number };

/** Every dated occurrence of the active slots in the next `weeks` weeks, with who is signed up and the gap (including exam-period buffers). */
export function coverage(chapterId: string, weeks = 4, at: Date = nowDate()): Occurrence[] {
  const db = getDb();
  const tz = getChapter(chapterId).timezone;
  const from = localDate(tz, at);
  const to = addDays(from, weeks * 7 - 1);
  const periods = listPeriods(chapterId);
  const out: Occurrence[] = [];
  for (const slot of listSlots(chapterId, { activeOnly: true })) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (weekdayOf(d) !== slot.weekday) continue;
      const covering = periods.filter((p) => p.startDate <= d && d <= p.endDate);
      const boost = covering.reduce((n, p) => Math.max(n, p.extraNeeded), 0);
      const signedUp = db.prepare('SELECT u.id, u.name FROM shift_signup s JOIN "user" u ON u.id = s.user_id WHERE s.slot_id = ? AND s.date = ? ORDER BY s.created_at, s.rowid').all(slot.id, d) as { id: string; name: string }[];
      const needed = slot.needed + boost;
      out.push({ slotId: slot.id, label: slot.label, date: d, start: slot.start, end: slot.end, needed: slot.needed, boost, periodLabel: covering[0]?.label ?? null, signedUp, gap: Math.max(0, needed - signedUp.length) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

export function listCoverage(actor: Actor, chapterId: string, weeks = 4, at: Date = nowDate()): Occurrence[] {
  requireCoordinator(actor, chapterId);
  return coverage(chapterId, weeks, at);
}

// ---- volunteers sign up --------------------------------------------------------------------------------------------------------------
export function signUpShift(actor: Actor, slotId: string, raw: unknown, at: Date = nowDate()) {
  const slot = getSlot(slotId);
  const { date } = signupSchema.parse(raw);
  if (!isVolunteerOf(actor, slot.chapterId)) throw notFound("Shift not found");
  if (!slot.active) throw conflict("slot_inactive", "This shift is not running.");
  if (!safetyAcknowledgedAt(actor.id)) throw conflict("safety_not_acknowledged", "Acknowledge the Safety rules before signing up for a shift.");
  const tz = getChapter(slot.chapterId).timezone;
  const today = localDate(tz, at);
  if (weekdayOf(date) !== slot.weekday) throw invalid(`That date is not a ${WEEKDAYS[slot.weekday]}.`);
  if (date < today || date > addDays(today, SIGNUP_WEEKS * 7)) throw invalid(`Choose a date from today to ${SIGNUP_WEEKS} weeks ahead.`);
  const occ = coverage(slot.chapterId, SIGNUP_WEEKS + 1, at).find((o) => o.slotId === slotId && o.date === date);
  if (occ && occ.gap === 0) throw conflict("shift_full", "That shift already has all the volunteers it needs.");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM shift_signup WHERE slot_id = ? AND user_id = ? AND date = ?").get(slotId, actor.id, date)) throw conflict("already_signed_up", "You are already signed up for that shift.");
  db.prepare("INSERT INTO shift_signup (slot_id, user_id, date, created_at) VALUES (?,?,?,?)").run(slotId, actor.id, date, now());
  logAudit(actor.id, "shift_signed_up", { chapterId: slot.chapterId, subjectType: "shift", subjectId: slotId, detail: { date } });
}
export function cancelShiftSignup(actor: Actor, slotId: string, date: string) {
  const r = getDb().prepare("DELETE FROM shift_signup WHERE slot_id = ? AND user_id = ? AND date = ?").run(slotId, actor.id, date);
  if (!r.changes) throw notFound("You are not signed up for that shift.");
}

export type MyShift = { slotId: string; chapterSlug: string; chapterName: string; timezone: string; label: string; date: string; start: string; end: string; startAt: string };
export function myShifts(actor: Actor, at: Date = nowDate()): MyShift[] {
  const rows = getDb()
    .prepare(
      `SELECT s.slot_id AS slotId, c.slug AS chapterSlug, c.name AS chapterName, c.timezone, sl.label, s.date, sl.start_time AS start, sl.end_time AS end
         FROM shift_signup s JOIN shift_slot sl ON sl.id = s.slot_id JOIN chapter c ON c.id = sl.chapter_id WHERE s.user_id = ? ORDER BY s.date, sl.start_time`,
    )
    .all(actor.id) as Omit<MyShift, "startAt">[];
  return rows
    .map((r) => ({ ...r, startAt: zonedToUtc(r.date, r.start, r.timezone).toISOString() }))
    .filter((r) => new Date(zonedToUtc(r.date, r.end, r.timezone)) > at);
}

/** Open occurrences in my chapters that I could sign up for (still short of volunteers, not already mine). */
export function openShifts(actor: Actor, at: Date = nowDate()): (Occurrence & { chapterSlug: string })[] {
  const out: (Occurrence & { chapterSlug: string })[] = [];
  for (const m of getDb().prepare("SELECT chapter_id AS id FROM chapter_member WHERE user_id = ?").all(actor.id) as { id: string }[]) {
    const ch = getChapter(m.id);
    for (const o of coverage(m.id, SIGNUP_WEEKS, at)) if (o.gap > 0 && !o.signedUp.some((s) => s.id === actor.id)) out.push({ ...o, chapterSlug: ch.slug });
  }
  return out;
}

// ---- suggestions and reminders ---------------------------------------------------------------------------------------------------------
/** Volunteers signed up for a shift that overlaps [start, end): who a coordinator should suggest for a pickup or delivery then. */
export function onShift(chapterId: string, start: Date, end: Date): string[] {
  const db = getDb();
  const tz = getChapter(chapterId).timezone;
  const date = localDate(tz, start);
  const ids = new Set<string>();
  for (const slot of listSlots(chapterId, { activeOnly: true })) {
    if (weekdayOf(date) !== slot.weekday) continue;
    const s = zonedToUtc(date, slot.start, tz), e = zonedToUtc(date, slot.end, tz);
    if (s < end && start < e) for (const r of db.prepare("SELECT user_id AS id FROM shift_signup WHERE slot_id = ? AND date = ? ORDER BY created_at, rowid").all(slot.id, date) as { id: string }[]) ids.add(r.id);
  }
  return [...ids];
}
export const onShiftOnDate = (chapterId: string, date: string): string[] => {
  const tz = getChapter(chapterId).timezone;
  return onShift(chapterId, zonedToUtc(date, "00:00", tz), zonedToUtc(date, "23:59", tz));
};

/** Emails each volunteer once, within 24 hours before a shift they signed up for. Run from the sweep job. */
export function sendShiftReminders(at: Date = nowDate()): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.slot_id AS slotId, s.user_id AS userId, s.date, sl.label, sl.start_time AS start, c.timezone FROM shift_signup s JOIN shift_slot sl ON sl.id = s.slot_id JOIN chapter c ON c.id = sl.chapter_id
        WHERE s.reminded_at IS NULL AND s.date BETWEEN ? AND ?`,
    )
    .all(addDays(at.toISOString().slice(0, 10), -1), addDays(at.toISOString().slice(0, 10), 2)) as { slotId: string; userId: string; date: string; label: string; start: string; timezone: string }[];
  let n = 0;
  for (const r of rows) {
    const startAt = zonedToUtc(r.date, r.start, r.timezone);
    if (startAt <= at || startAt > hoursFrom(at, 24)) continue;
    db.prepare("UPDATE shift_signup SET reminded_at = ? WHERE slot_id = ? AND user_id = ? AND date = ?").run(at.toISOString(), r.slotId, r.userId, r.date);
    notifyShiftReminder(r.userId, r.label, startAt.toISOString(), r.timezone);
    n++;
  }
  return n;
}
