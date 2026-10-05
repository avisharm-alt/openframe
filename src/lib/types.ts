// Safe to import from client code (no server dependencies).

/** Global role on the user record. Server-controlled; clients can never set it. */
export type Role = "member" | "admin";
/** Per-chapter roles, stored in chapter_member. */
export type ChapterRole = "volunteer" | "coordinator";
export type Actor = { id: string; role: Role; name?: string };

export const isAdmin = (a: Actor | null | undefined): a is Actor => !!a && a.role === "admin";

export const ITEM_CATEGORIES = ["hygiene", "clothing", "winter_gear", "menstrual", "first_aid", "snacks_sealed", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  hygiene: "Hygiene",
  clothing: "Clothing",
  winter_gear: "Winter gear",
  menstrual: "Menstrual",
  first_aid: "First aid",
  snacks_sealed: "Snacks (sealed)",
  other: "Other",
};

export const NEED_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type NeedPriority = (typeof NEED_PRIORITIES)[number];
export const PRIORITY_RANK: Record<NeedPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
export const NEED_STATUSES = ["open", "met", "closed"] as const;

export const PLEDGE_METHODS = ["pickup", "dropoff"] as const;
export type PledgeMethod = (typeof PLEDGE_METHODS)[number];
export const PLEDGE_STATUSES = ["pledged", "scheduled", "collected", "received", "cancelled", "no_show"] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];
export const PLEDGE_STATUS_LABELS: Record<PledgeStatus, string> = {
  pledged: "Pledged",
  scheduled: "Scheduled",
  collected: "Collected",
  received: "Received",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const OUTCOME_REASONS = ["nobody_home", "volunteer_unavailable", "safety_concern", "other"] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];
export const OUTCOME_REASON_LABELS: Record<OutcomeReason, string> = {
  nobody_home: "Nobody was there at the pickup",
  volunteer_unavailable: "I can no longer make it",
  safety_concern: "I had a safety concern",
  other: "Something else",
};

export const CONCERN_CATEGORIES = ["safety", "conduct", "no_show", "other"] as const;
export type ConcernCategory = (typeof CONCERN_CATEGORIES)[number];
export const CONCERN_LABELS: Record<ConcernCategory, string> = {
  safety: "I felt unsafe",
  conduct: "Inappropriate behaviour",
  no_show: "Someone did not show up",
  other: "Something else",
};
export const REPORT_STATES = ["open", "investigating", "resolved", "dismissed"] as const;

/** Pickup windows are daytime only, in the chapter's local time. */
export const WINDOW_EARLIEST = "09:00";
export const WINDOW_LATEST = "20:00";
