import { getImpact, ACTIVE_DAYS, IMPACT_WEEKS } from "@/lib/services/impact";

export const metadata = { title: "Impact" };

const fmtHours = (h: number | null) => (h === null ? "–" : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`);
const fmtPct = (p: number | null) => (p === null ? "–" : `${p}%`);

export default function Impact() {
  const impact = getImpact();
  const { overall } = impact;
  return (
    <>
      <h1>Impact</h1>
      <p className="muted" style={{ maxWidth: "44rem" }}>
        Counts only. We record which partner received an item and when, never anything about the people who receive items, and never anything about individual neighbours or volunteers here.
      </p>

      <section className="headline" aria-labelledby="median-h">
        <p className="eyebrow">Our headline number</p>
        <h2 id="median-h" style={{ margin: 0 }}>Median time from request to delivery</h2>
        <p className="big-number" aria-live="polite">{fmtHours(overall.medianHours)}</p>
        <p className="muted">
          From the moment a partner posts a request to the moment it is delivered to their site. Our target is under {impact.targetHours} hours.{" "}
          {overall.fulfilled > 0 ? <>{fmtPct(overall.within72hPct)} of the {overall.fulfilled} requests so far arrived within {impact.targetHours} hours.</> : "No requests have been delivered yet."}
        </p>
      </section>

      {impact.chapters.map((c) => {
        const max = Math.max(1, ...c.weekly.map((w) => w.fulfilled));
        return (
          <section key={c.slug} className="section" aria-labelledby={`h-${c.slug}`}>
            <h2 id={`h-${c.slug}`} style={{ marginTop: 0 }}>{c.name}</h2>
            <div className="stats">
              <div className="stat"><b>{fmtHours(c.medianHours)}</b>median time to delivery</div>
              <div className="stat"><b>{fmtPct(c.within72hPct)}</b>delivered within {impact.targetHours} h</div>
              <div className="stat"><b>{fmtPct(c.onTimePct)}</b>delivered by the needed-by date</div>
              <div className="stat"><b>{c.fulfilled}</b>requests fulfilled</div>
              <div className="stat"><b>{c.activeNeighbours}</b>active neighbours</div>
              <div className="stat"><b>{c.volunteerHours}</b>volunteer hours</div>
            </div>
            <h3>Where the items came from</h3>
            <p>
              {c.fromStockPct === null ? "No deliveries yet." : <><b>{c.fromStockPct}%</b> filled from our fast stock (same-day when the shelf has it) and <b>{c.fromClaimsPct}%</b> by neighbours’ claims.</>}
            </p>
            <h3>Requests fulfilled per week</h3>
            <ul className="bars" aria-label={`Requests fulfilled per week in ${c.name}, last ${IMPACT_WEEKS} weeks`}>
              {c.weekly.map((w) => (
                <li key={w.weekStart}>
                  <span>Week of {w.weekStart.slice(5)}</span>
                  <span className="bar" style={{ width: `${(w.fulfilled / max) * 100}%` }} aria-hidden="true" />
                  <span className="n">{w.fulfilled}</span>
                </li>
              ))}
            </ul>
            {c.byPartner.length > 0 && (
              <>
                <h3>By partner</h3>
                <ul>{c.byPartner.map((p) => <li key={p.name}><b>{p.name}</b>: {p.fulfilled} request{p.fulfilled === 1 ? "" : "s"} delivered</li>)}</ul>
              </>
            )}
            <p className="small muted">
              Active neighbours: people who made a claim in the last {ACTIVE_DAYS} days. Volunteer hours: time checked in on pickups plus time on delivery runs. Weeks start on Monday.
            </p>
          </section>
        );
      })}
    </>
  );
}
