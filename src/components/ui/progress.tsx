export type Segment = {
  /** Visual tone: matches the status colours. */
  tone: "delivered" | "claimed" | "transit" | "open" | "urgent" | "accent";
  value: number;
  /** Text for the legend and screen readers, e.g. "delivered". */
  label: string;
};

/**
 * Progress toward a goal. One or several stacked segments (e.g. delivered + claimed, out of needed).
 * Always has a text alternative: role="progressbar" with a name and a value text, plus an optional
 * visible legend so the numbers are never conveyed by colour alone.
 */
export function ProgressBar({
  label,
  max,
  segments,
  value,
  valueText,
  legend = true,
  size = "md",
  remainingLabel = "still needed",
}: {
  label: string;
  max: number;
  segments?: Segment[];
  /** Shorthand for a single accent segment. */
  value?: number;
  /** Overrides the default "N of M" text. */
  valueText?: string;
  legend?: boolean;
  size?: "sm" | "md";
  remainingLabel?: string;
}) {
  const segs: Segment[] = segments ?? [{ tone: "accent", value: value ?? 0, label: "complete" }];
  const total = segs.reduce((n, s) => n + s.value, 0);
  const capped = Math.min(total, max);
  const text = valueText ?? `${capped} of ${max}`;
  const pct = (n: number) => (max > 0 ? Math.min(100, Math.max(0, (n / max) * 100)) : 0);
  const remaining = Math.max(0, max - total);
  return (
    <div className="pbar" data-size={size === "sm" ? "sm" : undefined}>
      <div className="pbar-head">
        <span className="pbar-label">{label}</span>
        <span className="pbar-value">{text}</span>
      </div>
      <div className="pbar-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={capped} aria-valuetext={text}>
        {segs.map((s) => (
          <span key={s.label} className="pbar-seg" data-tone={s.tone === "accent" ? undefined : s.tone} style={{ width: `${pct(s.value)}%` }} />
        ))}
      </div>
      {legend && segs.length > 0 && (
        <ul className="pbar-legend" aria-label={`${label}: breakdown`}>
          {segs.map((s) => (
            <li key={s.label} data-tone={s.tone === "accent" ? undefined : s.tone}>
              <i aria-hidden="true" />
              {s.value} {s.label}
            </li>
          ))}
          {segs.length > 0 && (
            <li data-tone="remaining">
              <i aria-hidden="true" />
              {remaining} {remainingLabel}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
