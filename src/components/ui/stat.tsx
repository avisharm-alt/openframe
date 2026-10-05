import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** A big tabular number with a label. Group several in <Stats> for an impact row. */
export function Stat({ value, label, hint, icon, tone }: { value: ReactNode; label: ReactNode; hint?: ReactNode; icon?: IconName; tone?: "accent" }) {
  return (
    <div className="stat" data-tone={tone}>
      {icon && <Icon name={icon} className="stat-icon" />}
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Stats({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="stats" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
