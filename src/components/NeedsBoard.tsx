import type { BoardLine } from "@/lib/services/needs";

const pct = (n: number, d: number) => (d <= 0 ? 0 : Math.max(0, Math.min(100, (n / d) * 100)));

export function Meter({ needed, pledged, received }: { needed: number; pledged: number; received: number }) {
  const got = pct(received, needed);
  const promised = Math.min(pct(pledged, needed), 100 - got);
  return (
    <div className="meter" role="img" aria-label={`${received} of ${needed} received, ${pledged} more pledged`}>
      <span className="got" style={{ width: `${got}%` }} />
      <span className="promised" style={{ width: `${promised}%` }} />
    </div>
  );
}

/** The live "What we need right now" list: most pressing first, with needed / pledged / received. */
export function NeedsBoard({ lines }: { lines: BoardLine[] }) {
  if (lines.length === 0) {
    return <p className="notice" role="status">Nothing is needed right now. Thank you! Check back soon, or see the <a href="/impact">impact page</a>.</p>;
  }
  return (
    <>
      <p className="legend" aria-hidden="true">
        <span><span className="swatch got" />Received</span>
        <span><span className="swatch promised" />Pledged, on its way</span>
      </p>
      <ul className="need-list">
        {lines.map((l) => (
          <li key={l.needId}>
            <div className="need-head">
              <span className="need-name">{l.itemName}</span>
              {l.priority === "urgent" && <span className="badge urgent">Urgent</span>}
              {l.priority === "high" && <span className="badge high">High priority</span>}
              <span className="badge">{l.newOnly ? "New only" : "New or clean"}</span>
            </div>
            {l.note && <p className="need-note">{l.note}</p>}
            <Meter needed={l.needed} pledged={l.pledged} received={l.received} />
            <p className="figures">
              <span><b>{l.remaining}</b> still needed</span>
              <span>needed {l.needed}</span>
              <span>pledged {l.pledged}</span>
              <span>received {l.received}</span>
              <span>{l.unit}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
