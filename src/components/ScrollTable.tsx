/** A table that scrolls sideways inside its own box on narrow screens: a labelled region that can take keyboard focus. */
export function ScrollTable({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
