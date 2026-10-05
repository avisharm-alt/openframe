import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** The six request/delivery states. Each has a distinct hue AND a distinct icon and word, so colour is never the only signal. */
export const STATUSES = {
  urgent: { label: "Urgent", icon: "alert" },
  open: { label: "Open", icon: "box" },
  claimed: { label: "Claimed", icon: "heart" },
  "in-transit": { label: "In transit", icon: "truck" },
  delivered: { label: "Delivered", icon: "check" },
  overdue: { label: "Overdue", icon: "clock" },
} as const satisfies Record<string, { label: string; icon: IconName }>;
export type StatusKey = keyof typeof STATUSES;
export const STATUS_KEYS = Object.keys(STATUSES) as StatusKey[];

/** Pill for a request status: icon + word, coloured from the --status-* tokens. */
export function StatusPill({ status, children }: { status: StatusKey; children?: ReactNode }) {
  const s = STATUSES[status];
  return (
    <span className={`pill pill-${status}`}>
      <Icon name={s.icon} />
      {children ?? s.label}
    </span>
  );
}

type BadgeTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";
const BADGE_CLASS: Record<BadgeTone, string> = { neutral: "", accent: " accent", info: " info", success: " ok", warning: " demo", danger: " bad" };

/** Small neutral or toned label (category, count, "Demo"). For request states use StatusPill instead. */
export function Badge({ tone = "neutral", icon, children }: { tone?: BadgeTone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`badge${BADGE_CLASS[tone]}`}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}
