import { createElement, type ComponentPropsWithoutRef, type ReactNode } from "react";

type Gap = 1 | 2 | 3 | 4 | 5 | 6;
type Tag = "div" | "section" | "ul" | "ol" | "li" | "nav" | "header" | "footer" | "article" | "aside";

type BaseProps = {
  /** Spacing step, from the --space-* scale (1 = 4px … 6 = 32px). */
  gap?: Gap;
  /** Element to render. Use "ul"/"ol" for real lists (add role-appropriate children). */
  as?: Tag;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

/** Vertical rhythm: children are separated by a consistent gap instead of one-off margins. */
export function Stack({ gap, as = "div", className, children, ...rest }: BaseProps) {
  return createElement(as, { className: cx("stack", className), "data-gap": gap, ...rest }, children);
}

/** Horizontal group that wraps on narrow screens (buttons, badges, meta). */
export function Cluster({
  gap,
  as = "div",
  justify,
  align,
  nowrap,
  className,
  children,
  ...rest
}: BaseProps & { justify?: "between" | "end" | "center"; align?: "start" | "end"; nowrap?: boolean }) {
  return createElement(
    as,
    { className: cx("cluster", className), "data-gap": gap, "data-justify": justify, "data-align": align, "data-nowrap": nowrap ? "" : undefined, ...rest },
    children,
  );
}
