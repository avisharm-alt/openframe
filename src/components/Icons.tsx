/** Small decorative icons. All are aria-hidden; the control or text next to them carries the accessible name. */
type P = { size?: number; className?: string };

/** An open frame with a spark in the gap. Uses currentColor for the frame and the accent colour for the spark. */
export function BrandMark({ size = 24, className }: P) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M14 3.5H8.5a5 5 0 0 0-5 5v7a5 5 0 0 0 5 5h7a5 5 0 0 0 5-5V10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="17.6" cy="6.4" r="2.4" fill="var(--accent)" />
    </svg>
  );
}

export function SearchIcon({ size = 20, className }: P) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 20, className }: P) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 19V5" />
      <path d="m5.5 11.5 6.5-6.5 6.5 6.5" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16, className }: P) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 12h14" />
      <path d="m12.5 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  );
}
