import { getDb } from "../db";
import { addDays, hoursFrom, localDate, nowDate, weekStart } from "../time";
import { listChapters } from "./chapters";

export type WeeklyCount = { weekStart: string; packages: number };
export type ChapterImpact = {
  slug: string;
  name: string;
  city: string;
  packagesHandedOff: number;
  itemsReceived: number;
  activeVolunteers: number;
  weekly: WeeklyCount[]; // oldest first, current week last
};
export const IMPACT_WEEKS = 12;
export const ACTIVE_VOLUNTEER_DAYS = 90;

/**
 * Public impact numbers. Counts only: there is nothing about individual donors, volunteers or recipients here.
 * "Active volunteers" = volunteers and coordinators with at least one pickup assignment in the last 90 days.
 */
export function getImpact(): ChapterImpact[] {
  const db = getDb();
  const cutoff = hoursFrom(nowDate(), -24 * ACTIVE_VOLUNTEER_DAYS).toISOString();
  return listChapters().map((c) => {
    const handed = db.prepare("SELECT handed_off_on AS d FROM package WHERE chapter_id = ? AND status = 'handed_off'").all(c.id) as { d: string }[];
    const thisWeek = weekStart(localDate(c.timezone));
    const weeks = Array.from({ length: IMPACT_WEEKS }, (_, i) => addDays(thisWeek, -7 * (IMPACT_WEEKS - 1 - i)));
    const counts = new Map(weeks.map((w) => [w, 0]));
    for (const h of handed) {
      const w = weekStart(h.d);
      if (counts.has(w)) counts.set(w, counts.get(w)! + 1);
    }
    const items = db.prepare("SELECT COALESCE(SUM(delta), 0) AS n FROM inventory_ledger WHERE chapter_id = ? AND kind = 'received'").get(c.id) as { n: number };
    const vols = db
      .prepare(
        `SELECT COUNT(DISTINCT a.volunteer_id) AS n FROM pickup_assignment a JOIN pickup p ON p.id = a.pickup_id
          JOIN chapter_member m ON m.user_id = a.volunteer_id AND m.chapter_id = p.chapter_id
          WHERE p.chapter_id = ? AND a.assigned_at >= ?`,
      )
      .get(c.id, cutoff) as { n: number };
    return {
      slug: c.slug, name: c.name, city: c.city,
      packagesHandedOff: handed.length, itemsReceived: items.n, activeVolunteers: vols.n,
      weekly: weeks.map((w) => ({ weekStart: w, packages: counts.get(w)! })),
    };
  });
}
