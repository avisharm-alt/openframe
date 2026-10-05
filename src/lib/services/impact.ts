import { getDb } from "../db";
import { addDays, hoursFrom, localDate, nowDate, weekStart } from "../time";
import { listChapters } from "./chapters";

export const IMPACT_WEEKS = 12;
export const ACTIVE_DAYS = 90;
export const TARGET_HOURS = 72;

export type DeliveredRow = { createdAt: string; deliveredAt: string; neededBy: string; filledFromStock: boolean; partnerName: string };
export type ChapterImpact = {
  slug: string; name: string; city: string;
  fulfilled: number;                         // requests delivered to a partner, all time
  weekly: { weekStart: string; fulfilled: number }[]; // oldest first, current week last
  byPartner: { name: string; fulfilled: number }[];
  medianHours: number | null;                // headline: time from request to delivery
  within72hPct: number | null;               // share delivered within the 72 hour target
  onTimePct: number | null;                  // share delivered by their needed-by date
  fromStockPct: number | null;               // filled from fast stock
  fromClaimsPct: number | null;              // filled by neighbour claims
  activeNeighbours: number;
  volunteerHours: number;
};
export type Impact = { overall: { fulfilled: number; medianHours: number | null; within72hPct: number | null }; targetHours: number; chapters: ChapterImpact[] };

/** Median of a list (average of the middle two for an even count); null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 100));
export const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pure: the time-to-delivery numbers for a set of delivered requests (hours are request created -> delivered). */
export function summarize(rows: DeliveredRow[], timezone: string) {
  const hours = rows.map((r) => hoursBetween(r.createdAt, r.deliveredAt));
  const med = median(hours);
  const stock = rows.filter((r) => r.filledFromStock).length;
  return {
    medianHours: med === null ? null : round1(med),
    within72hPct: pct(hours.filter((h) => h <= TARGET_HOURS).length, rows.length),
    onTimePct: pct(rows.filter((r) => localDate(timezone, new Date(r.deliveredAt)) <= r.neededBy).length, rows.length),
    fromStockPct: pct(stock, rows.length),
    fromClaimsPct: rows.length ? 100 - pct(stock, rows.length)! : null,
  };
}

/**
 * Public impact numbers, counts only: nothing about individual neighbours, volunteers or recipients.
 * Headline: median hours from a partner's request to delivery at their site (restock requests are the chapter's own and
 * are not counted). "Volunteer hours" are time spent checked in on pickups plus time on delivery runs; shift sign-ups alone do not count.
 */
export function getImpact(at: Date = nowDate()): Impact {
  const db = getDb();
  const cutoff = hoursFrom(at, -24 * ACTIVE_DAYS).toISOString();
  const all: DeliveredRow[] = [];
  const chapters = listChapters().map((c) => {
    const rows = db
      .prepare(
        `SELECT q.created_at AS createdAt, q.delivered_at AS deliveredAt, q.needed_by AS neededBy, q.filled_from_stock AS stock, p.name AS partnerName
           FROM request q JOIN partner p ON p.id = q.partner_id WHERE q.chapter_id = ? AND q.type <> 'restock' AND q.delivered_at IS NOT NULL AND q.status IN ('delivered','confirmed')`,
      )
      .all(c.id) as { createdAt: string; deliveredAt: string; neededBy: string; stock: number; partnerName: string }[];
    const delivered: DeliveredRow[] = rows.map((r) => ({ createdAt: r.createdAt, deliveredAt: r.deliveredAt, neededBy: r.neededBy, filledFromStock: !!r.stock, partnerName: r.partnerName }));
    all.push(...delivered);
    const thisWeek = weekStart(localDate(c.timezone, at));
    const weeks = Array.from({ length: IMPACT_WEEKS }, (_, i) => addDays(thisWeek, -7 * (IMPACT_WEEKS - 1 - i)));
    const counts = new Map(weeks.map((w) => [w, 0]));
    const partners = new Map<string, number>();
    for (const d of delivered) {
      const w = weekStart(localDate(c.timezone, new Date(d.deliveredAt)));
      if (counts.has(w)) counts.set(w, counts.get(w)! + 1);
      partners.set(d.partnerName, (partners.get(d.partnerName) ?? 0) + 1);
    }
    const neighbours = db.prepare("SELECT COUNT(DISTINCT neighbour_id) AS n FROM claim WHERE chapter_id = ? AND created_at >= ? AND status <> 'cancelled' AND neighbour_id IS NOT NULL").get(c.id, cutoff) as { n: number };
    const pickupMs = (db.prepare("SELECT arrived_at AS a, completed_at AS b FROM pickup_assignment pa JOIN pickup k ON k.id = pa.pickup_id WHERE k.chapter_id = ? AND pa.arrived_at IS NOT NULL AND pa.completed_at IS NOT NULL").all(c.id) as { a: string; b: string }[]).reduce((n, r) => n + hoursBetween(r.a, r.b), 0);
    const deliveryMs = (db.prepare("SELECT d.started_at AS a, d.completed_at AS b, (SELECT COUNT(*) FROM delivery_volunteer v WHERE v.delivery_id = d.id) AS n FROM delivery d WHERE d.chapter_id = ? AND d.status = 'completed' AND d.started_at IS NOT NULL").all(c.id) as { a: string; b: string; n: number }[]).reduce((n, r) => n + hoursBetween(r.a, r.b) * r.n, 0);
    return {
      slug: c.slug, name: c.name, city: c.city, fulfilled: delivered.length,
      weekly: weeks.map((w) => ({ weekStart: w, fulfilled: counts.get(w)! })),
      byPartner: [...partners.entries()].map(([name, fulfilled]) => ({ name, fulfilled })).sort((a, b) => b.fulfilled - a.fulfilled || a.name.localeCompare(b.name)),
      ...summarize(delivered, c.timezone),
      activeNeighbours: neighbours.n,
      volunteerHours: round1(pickupMs + deliveryMs),
    };
  });
  const med = median(all.map((r) => hoursBetween(r.createdAt, r.deliveredAt)));
  return {
    targetHours: TARGET_HOURS,
    overall: { fulfilled: all.length, medianHours: med === null ? null : round1(med), within72hPct: pct(all.filter((r) => hoursBetween(r.createdAt, r.deliveredAt) <= TARGET_HOURS).length, all.length) },
    chapters,
  };
}
