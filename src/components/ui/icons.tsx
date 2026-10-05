import type { SVGProps } from "react";

/** Inline SVG icon set (stroke icons on a 24px grid). No icon font, no dependency. */
const PATHS = {
  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7" />
      <circle cx="7" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5.5 9.5V20h13V9.5M10 20v-6h4v6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.2a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.8" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  heart: <path d="M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 8 2.5c0 5.9-8 10.6-8 10.6z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17.2" cy="9" r="2.5" />
      <path d="M17.2 14.6c2.4.2 3.8 2 3.8 4.4" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  "arrow-right": <path d="M5 12h14m-6-6 6 6-6 6" />,
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  size?: number | string;
  /** Accessible name. Omit for decorative icons (the default), which are hidden from assistive tech. */
  title?: string;
};

export function Icon({ name, size = 20, title, strokeWidth = 1.9, ...rest }: IconProps) {
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const, focusable: false as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The OpenFrame mark: an open frame (a doorway) with a warm light inside. Decorative; sits beside the wordmark. */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props}>
      <rect className="bm-tile" width="32" height="32" rx="9" />
      <path className="bm-frame" d="M9 24V12.5L16 7l7 5.5V24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="bm-sun" cx="16" cy="17.5" r="3" />
    </svg>
  );
}
