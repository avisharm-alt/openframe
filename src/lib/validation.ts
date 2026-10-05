import { z } from "zod";
import { CLAIM_METHODS, CONCERN_CATEGORIES, ITEM_CATEGORIES, OUTCOME_REASONS, REPORT_STATES, SIZE_SCHEMES, URGENCIES } from "./types";
import { isDateString, isValidTimezone } from "./time";

// All input objects are strict: unknown keys (for example an attempt to send recipient details) are rejected.
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const id = z.string().trim().min(8).max(64);
const qty = (max: number) => z.number().int().min(1).max(max);
const date = z.string().refine(isDateString, "Use a date like 2026-11-08.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 14:30.");
const size = z.string().trim().max(8).default("");

/** Request notes are public and must stay anonymous: short, and no emails, phone numbers or links. */
export const REQUEST_NOTE_MAX = 140;
export const looksIdentifying = (s: string) => /@|https?:\/\/|www\./i.test(s) || /\d[\d\s().-]{6,}\d/.test(s);
const note = z
  .string()
  .trim()
  .max(REQUEST_NOTE_MAX)
  .default("")
  .refine((s) => !looksIdentifying(s), "Do not include phone numbers, emails or links. Keep it about the item, never the person.");

export const chapterSchema = z.strictObject({
  name: text(80, 2),
  city: text(80, 2),
  timezone: z.string().trim().refine(isValidTimezone, "Use an IANA timezone such as America/Toronto."),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").min(2).max(40).optional(),
});

export const zoneSchema = z.strictObject({ name: text(80), description: text(300), hours: optionalText(120), active: z.boolean().default(true) });
export const zonePatchSchema = zoneSchema.partial();

export const itemSchema = z.strictObject({
  name: text(80),
  category: z.enum(ITEM_CATEGORIES),
  sizeScheme: z.enum(SIZE_SCHEMES).default("none"),
  unit: text(20),
  newOnly: z.boolean().default(true),
});

// ---- partners, sites, workers ------------------------------------------------------------------------------------------
export const partnerSchema = z.strictObject({
  name: text(80),
  description: optionalText(300),
  excludedItems: optionalText(300),
});
export const partnerPatchSchema = partnerSchema.extend({ active: z.boolean() }).partial();
export const partnerApplySchema = z.strictObject({ chapter: text(40), name: text(80), description: optionalText(300) });
export const siteSchema = z.strictObject({ name: text(80), address: text(200), receivingHours: optionalText(120), active: z.boolean().default(true) });
export const sitePatchSchema = siteSchema.partial();
export const decisionSchema = z.strictObject({ decision: z.enum(["approved", "rejected", "suspended"]) });

export const memberSchema = z.strictObject({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(["volunteer", "coordinator"]) });

// ---- requests ------------------------------------------------------------------------------------------------------------
export const requestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("item"),
    partnerId: id,
    siteId: id,
    itemId: id,
    size,
    quantity: qty(500),
    neededBy: date,
    urgency: z.enum(URGENCIES).default("normal"),
    note,
  }),
  z.strictObject({
    type: z.literal("kit"),
    partnerId: id,
    siteId: id,
    kitTemplateId: id,
    quantity: qty(200),
    neededBy: date,
    urgency: z.enum(URGENCIES).default("normal"),
    note,
  }),
]);
export const favouriteSchema = z.strictObject({ itemId: id, size, quantity: qty(500), siteId: id.optional(), urgency: z.enum(URGENCIES).default("normal") });

// ---- claims and pickups --------------------------------------------------------------------------------------------------
export const windowSchema = z.strictObject({ date, start: time, end: time });

export const claimSchema = z.discriminatedUnion("method", [
  z.strictObject({
    requestId: id,
    quantity: qty(500),
    method: z.literal("pickup"),
    address: text(300, 5),
    notes: optionalText(500),
    phone: z.string().trim().max(30).regex(/^[0-9+()\-.\s]*$/, "Use digits and + ( ) - . only.").default(""),
    windows: z.array(windowSchema).min(1).max(3),
  }),
  z.strictObject({ requestId: id, quantity: qty(500), method: z.literal("dropoff"), zoneId: id, expectedDate: date }),
]);
export const reschedulePickupSchema = z.strictObject({ windows: z.array(windowSchema).min(1).max(3) });
export const rescheduleDropoffSchema = z.strictObject({ zoneId: id, expectedDate: date });

export const receiveSchema = z.strictObject({
  // How many actually arrived (it may differ from what was claimed, down to zero), plus items nobody claimed.
  quantity: z.number().int().min(0).max(10000),
  extras: z.array(z.strictObject({ itemId: id, size, quantity: qty(10000) })).max(20).default([]),
  note: optionalText(200),
});
export const coordinatorStatusSchema = z.strictObject({ status: z.enum(["scheduled", "collected", "cancelled", "no_show"]), reason: optionalText(200) });

export const assignSchema = z.strictObject({ volunteerId: id });
export const confirmWindowSchema = z.strictObject({ windowId: id });
export const completeSchema = z.strictObject({
  outcome: z.enum(["collected", "could_not_complete"]),
  reason: z.enum(OUTCOME_REASONS).optional(),
  note: optionalText(300),
});

export const concernSchema = z.strictObject({ claimId: id, category: z.enum(CONCERN_CATEGORIES), details: optionalText(2000) });
export const concernUpdateSchema = z.strictObject({ state: z.enum(REPORT_STATES), resolutionNote: optionalText(1000) });

// ---- stock, kits, deliveries, shifts -----------------------------------------------------------------------------------
export const adjustSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("adjusted"), itemId: id, size, delta: z.number().int().min(-10000).max(10000).refine((n) => n !== 0, "Enter a non-zero change."), note: text(200) }),
  z.strictObject({ kind: z.literal("discarded"), itemId: id, size, quantity: qty(10000), note: text(200) }),
]);
export const targetSchema = z.strictObject({ itemId: id, size, target: z.number().int().min(0).max(10000) });
export const fillSchema = z.strictObject({});

export const kitTemplateSchema = z.strictObject({
  name: text(60),
  description: optionalText(300),
  active: z.boolean().default(true),
  items: z.array(z.strictObject({ itemId: id, size, quantity: qty(50) })).min(1).max(40),
});
export const kitTemplatePatchSchema = kitTemplateSchema.partial();
export const assembleSchema = z.strictObject({ templateId: id, count: qty(100) });

export const deliverySchema = z.strictObject({ siteId: id, requestIds: z.array(id).min(1).max(50), plannedFor: date });
export const deliveryNoteSchema = z.strictObject({});

export const slotSchema = z.strictObject({ label: text(60), weekday: z.number().int().min(0).max(6), start: time, end: time, needed: qty(10), active: z.boolean().default(true) });
export const slotPatchSchema = slotSchema.partial();
export const signupSchema = z.strictObject({ date });
export const periodSchema = z.strictObject({ label: text(60), startDate: date, endDate: date, extraNeeded: z.number().int().min(0).max(10) });

export { CLAIM_METHODS };
