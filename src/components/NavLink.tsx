"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header link that marks the current section with aria-current (also drives the active style). */
export function NavLink({ href, match, children }: { href: string; match?: string[]; children: React.ReactNode }) {
  const path = usePathname();
  const prefixes = match ?? [href];
  const current = href === "/" ? path === "/" || prefixes.some((p) => p !== "/" && path.startsWith(p)) : prefixes.some((p) => path === p || path.startsWith(p + "/"));
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
