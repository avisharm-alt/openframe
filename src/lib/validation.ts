import { z } from "zod";
import { CONCERN_CATEGORIES, ITEM_CATEGORIES, NEED_PRIORITIES, OUTCOME_REASONS, PLEDGE_METHODS, REPORT_STATES } from "./types";
import { isDateString, isValidTimezone } from "./time";

// All input objects are strict: unknown keys (for example an attempt to send recipient details) are rejected.
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const id = z.string().trim().min(8).max(64);
const qty = (max: number) => z.number().int().min(1).max(max);
const date = z.string().refine(isDateString, "Use a date like 2026-11-08.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 14:30.");

export const chapterSchema = z.strictObject({
  name: text(80, 2),
  city: text(80, 2),
  timezone: z.string().trim().refine(isValidTimezone, "Use an IANA timezone such as America/Toronto."),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").min(2).max(40).optional(),
});

export const zoneSchema = z.strictObject({
  name: text(80),
  description: text(300),
  hours: optionalText(120),
  active: z.boolean().default(true),
});
export const zonePatchSchema = zoneSchema.partial();

export const partnerSchema = z.strictObject({
  name: text(80),
  description: optionalText(300),
  acceptsPackages: z.boolean().default(true),
  active: z.boolean().default(true),
});
export const partnerPatchSchema = partnerSchema.partial();

export const itemSchema = z.strictObject({
  name: text(80),
  category: z.enum(ITEM_CATEGORIES),
  unit: text(20),
  newOnly: z.boolean().default(true),
});

export const templateSchema = z.strictObject({
  name: text(60),
  description: optionalText(300),
  weeklyTarget: z.number().int().min(0).max(1000),
  active: z.boolean().default(true),
  items: z.array(z.strictObject({ itemId: id, quantity: qty(50) })).min(1).max(40),
});
export const templatePatchSchema = templateSchema.partial();

export const needSchema = z.strictObject({
  itemId: id,
  quantity: qty(10000),
  priority: z.enum(NEED_PRIORITIES).default("normal"),
  note: optionalText(200),
});
export const needPatchSchema = z.strictObject({
  quantity: qty(10000).optional(),
  priority: z.enum(NEED_PRIORITIES).optional(),
  note: z.string().trim().max(200).optional(),
  status: z.enum(["open", "closed"]).optional(),
});

export const adjustSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("adjusted"), itemId: id, delta: z.number().int().min(-10000).max(10000).refine((n) => n !== 0, "Enter a non-zero change."), note: text(200) }),
  z.strictObject({ kind: z.literal("discarded"), itemId: id, quantity: qty(10000), note: text(200) }),
]);

export const assembleSchema = z.strictObject({ templateId: id, count: qty(50) });
// A hand-off records the agency and the date only. There is nowhere to put anything about the people served.
export const handoffSchema = z.strictObject({ packageIds: z.array(id).min(1).max(100), agencyId: id, date });

export const memberSchema = z.strictObject({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(["volunteer", "coordinator"]) });

// --- pledges and pickups -------------------------------------------------------------------------------------------

export const windowSchema = z.strictObject({ date, start: time, end: time });

const pledgeLines = z.array(z.strictObject({ needId: id, quantity: qty(10000) })).min(1).max(40);

export const pledgeSchema = z.discriminatedUnion("method", [
  z.strictObject({
    chapter: text(40),
    method: z.literal("pickup"),
    items: pledgeLines,
    address: text(300, 5),
    notes: optionalText(500),
    phone: z.string().trim().max(30).regex(/^[0-9+()\-.\s]*$/, "Use digits and + ( ) - . only.").default(""),
    windows: z.array(windowSchema).min(1).max(3),
  }),
  z.strictObject({
    chapter: text(40),
    method: z.literal("dropoff"),
    items: pledgeLines,
    zoneId: id,
    expectedDate: date,
  }),
]);

export const reschedulePickupSchema = z.strictObject({ windows: z.array(windowSchema).min(1).max(3) });
export const rescheduleDropoffSchema = z.strictObject({ zoneId: id, expectedDate: date });
export const rescheduleSchema = z.union([reschedulePickupSchema, rescheduleDropoffSchema]);

export const receiveSchema = z.strictObject({
  // received quantity per pledge line (may differ from what was pledged), plus items nobody pledged
  lines: z.array(z.strictObject({ lineId: id, quantity: z.number().int().min(0).max(10000) })).max(40),
  extras: z.array(z.strictObject({ itemId: id, quantity: qty(10000) })).max(20).default([]),
  note: optionalText(200),
});

export const coordinatorStatusSchema = z.strictObject({
  status: z.enum(["scheduled", "collected", "cancelled", "no_show"]),
  reason: optionalText(200),
});

export const assignSchema = z.strictObject({ volunteerId: id });
export const confirmWindowSchema = z.strictObject({ windowId: id });
export const completeSchema = z.strictObject({
  outcome: z.enum(["collected", "could_not_complete"]),
  reason: z.enum(OUTCOME_REASONS).optional(),
  note: optionalText(300),
});

export const concernSchema = z.strictObject({
  pledgeId: id,
  category: z.enum(CONCERN_CATEGORIES),
  details: optionalText(2000),
});
export const concernUpdateSchema = z.strictObject({ state: z.enum(REPORT_STATES), resolutionNote: optionalText(1000) });

export { PLEDGE_METHODS };
