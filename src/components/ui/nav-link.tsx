"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

/** next/link that sets aria-current="page" on the current section (exact match for "/", prefix match elsewhere). */
export function NavLink({ href, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return <Link href={href} aria-current={current ? "page" : undefined} {...rest} />;
}
