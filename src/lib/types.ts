// Safe to import from client code (no server dependencies).

/** Global role on the user record. Server-controlled; clients can never set it. */
export type Role = "member" | "admin";
/** Per-chapter roles, stored in chapter_member. */
export type ChapterRole = "volunteer" | "coordinator";
export type Actor = { id: string; role: Role; name?: string };

export const isAdmin = (a: Actor | null | undefined): boolean => !!a && a.role === "admin";

export const ITEM_CATEGORIES = ["clothing", "footwear", "winter_gear", "hygiene", "menstrual", "first_aid", "electronics", "bags", "snacks_sealed", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  clothing: "Clothing",
  footwear: "Footwear",
  winter_gear: "Winter gear",
  hygiene: "Hygiene",
  menstrual: "Menstrual",
  first_aid: "First aid",
  electronics: "Electronics (chargers)",
  bags: "Bags",
  snacks_sealed: "Snacks (sealed)",
  other: "Other",
};

export const SIZE_SCHEMES = ["none", "shoe", "letter", "numeric"] as const;
export type SizeScheme = (typeof SIZE_SCHEMES)[number];
export const SIZES: Record<SizeScheme, string[]> = {
  none: [],
  shoe: ["5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
  letter: ["XS", "S", "M", "L", "XL", "XXL"],
  numeric: ["0", "2", "4", "6", "8", "10", "12", "14", "16", "18", "20"],
};

export const URGENCIES = ["normal", "urgent"] as const;
export type Urgency = (typeof URGENCIES)[number];
export const REQUEST_TYPES = ["item", "kit", "restock"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_STATUSES = ["open", "claimed", "in_transit", "delivered", "confirmed", "expired", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  open: "Open",
  claimed: "Claimed",
  in_transit: "On its way",
  delivered: "Delivered",
  confirmed: "Confirmed by the agency",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const CLAIM_METHODS = ["pickup", "dropoff"] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];
export const CLAIM_STATUSES = ["claimed", "scheduled", "collected", "received", "cancelled", "no_show"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  claimed: "Claimed",
  scheduled: "Scheduled",
  collected: "Collected",
  received: "Received",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const LEDGER_KINDS = ["received", "allocated_to_request", "assembled_into_kit", "adjusted", "discarded"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

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
