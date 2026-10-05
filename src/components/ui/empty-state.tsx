import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Friendly "nothing here yet" panel: one line-icon, one sentence of context, one clear next step. */
export function EmptyState({ icon = "box", title, children, action, headingLevel = 3 }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode; headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div className="empty">
      <span className="empty-art" aria-hidden="true">
        <Icon name={icon} size={36} strokeWidth={1.6} />
      </span>
      <H className="empty-title">{title}</H>
      {children && <p className="empty-text">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** The reward moment: an animated check and a short, warm line. Animation is disabled under prefers-reduced-motion. */
export function DeliveredState({ title = "Delivered", children, headingLevel = 3 }: { title?: string; children?: ReactNode; headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div className="delivered" role="status">
      <span className="delivered-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path className="tick" d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
      <div>
        <H className="delivered-title">{title}</H>
        {children && <p className="delivered-text">{children}</p>}
      </div>
    </div>
  );
}
