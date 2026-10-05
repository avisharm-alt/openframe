"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

type Common = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Stretch to the full width of the container (good for mobile primary actions). */
  block?: boolean;
  icon?: IconName;
  children: ReactNode;
  className?: string;
};
type AsButton = Common & { href?: undefined; loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;
type AsLink = Common & { href: string; loading?: undefined } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className" | "href">;

const cls = ({ variant = "primary", size = "md", block, className }: Common) =>
  ["btn", variant !== "primary" && variant, size === "sm" && "small", size === "lg" && "large", block && "block", className].filter(Boolean).join(" ");

/**
 * Button, or a link that looks like one when `href` is given.
 * `loading` keeps the button focusable (aria-disabled, not disabled) and ignores clicks while it spins.
 */
export function Button(props: AsButton | AsLink) {
  const { variant, size, block, icon, children, className, ...rest } = props;
  const inner = (
    <>
      {icon && <Icon name={icon} />}
      {children}
    </>
  );
  if (props.href !== undefined) {
    const { href, ...anchor } = rest as AsLink;
    return (
      <Link href={href} className={cls({ variant, size, block, className, children })} {...anchor}>
        {inner}
      </Link>
    );
  }
  const { loading, onClick, type = "button", ...button } = rest as AsButton;
  return (
    <button
      type={type}
      className={cls({ variant, size, block, className, children })}
      aria-busy={loading || undefined}
      aria-disabled={loading || button.disabled || undefined}
      onClick={(e) => {
        if (loading) return e.preventDefault();
        onClick?.(e);
      }}
      {...button}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
      {children}
      {loading && <span className="sr-only"> Working…</span>}
    </button>
  );
}

/** Sticky bottom action area on phones, an inline row on larger screens. Put it last on a page with one primary action. */
export function ActionBar({ children, label = "Actions", sticky = true }: { children: ReactNode; label?: string; sticky?: boolean }) {
  return (
    <div className="action-bar" role="group" aria-label={label} data-sticky={sticky ? undefined : "false"}>
      {children}
    </div>
  );
}
