import type { ReactNode } from "react";

const CLASS = { info: "", success: " good", warning: " warn", danger: " bad" } as const;
export type NoticeTone = keyof typeof CLASS;

/**
 * Inline message. The icon is drawn by CSS from the tone, so legacy `<div class="notice warn">` markup gets it too.
 * Static content needs no role. Use `live` only when the notice appears after a user action
 * (polite = status, assertive = alert, for errors that block the user).
 */
export function Notice({ tone = "info", title, live, children, ...rest }: { tone?: NoticeTone; title?: ReactNode; live?: "polite" | "assertive"; children: ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div className={`notice${CLASS[tone]}`} role={live === "assertive" ? "alert" : live === "polite" ? "status" : undefined} {...rest}>
      {title && <strong className="notice-title">{title}</strong>}
      {children}
    </div>
  );
}
