import { createElement, type HTMLAttributes, type ReactNode } from "react";
import type { StatusKey } from "./status";

export type CardProps = {
  as?: "div" | "section" | "article" | "li" | "aside";
  /** soft = recessed, accent = evergreen tint, outline = no fill or shadow. */
  tone?: "default" | "soft" | "accent" | "outline";
  padding?: "sm" | "md" | "lg" | "none";
  /** Adds a gentle lift on hover. Only for cards that are (or contain) a single link target. */
  interactive?: boolean;
  /** Draws a coloured rail on the left edge. The status must ALSO be stated in text (use StatusPill). */
  status?: StatusKey;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

/** Surface for one unit of content. Soft radius, hairline border, very light shadow. */
export function Card({ as = "div", tone = "default", padding = "md", interactive, status, className, children, ...rest }: CardProps) {
  return createElement(
    as,
    {
      className: ["card", className].filter(Boolean).join(" "),
      "data-tone": tone === "default" ? undefined : tone,
      "data-pad": padding === "md" ? undefined : padding,
      "data-interactive": interactive ? "" : undefined,
      "data-status": status,
      ...rest,
    },
    children,
  );
}

export function CardTitle({ as: Tag = "h3", children, ...rest }: { as?: "h2" | "h3" | "h4" | "p"; children: ReactNode } & HTMLAttributes<HTMLHeadingElement>) {
  return (
    <Tag className="card-title" {...rest}>
      {children}
    </Tag>
  );
}
