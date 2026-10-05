import { getImpact, ACTIVE_VOLUNTEER_DAYS, IMPACT_WEEKS } from "@/lib/services/impact";

export const metadata = { title: "Impact" };

export default function Impact() {
  const chapters = getImpact();
  return (
    <>
      <h1>Impact</h1>
      <p className="muted" style={{ maxWidth: "44rem" }}>
        Counts only. We record how many packages each partner agency received, never anything about the people who receive them, and never anything about individual donors or volunteers here.
      </p>
      {chapters.map((c) => {
        const max = Math.max(1, ...c.weekly.map((w) => w.packages));
        return (
          <section key={c.slug} className="section" aria-labelledby={`h-${c.slug}`}>
            <h2 id={`h-${c.slug}`} style={{ marginTop: 0 }}>{c.name}</h2>
            <div className="stats">
              <div className="stat"><b>{c.packagesHandedOff}</b>packages handed off</div>
              <div className="stat"><b>{c.itemsReceived}</b>items received</div>
              <div className="stat"><b>{c.activeVolunteers}</b>active volunteers</div>
            </div>
            <h3>Packages handed off per week</h3>
            <ul className="bars" aria-label={`Packages handed off per week in ${c.name}, last ${IMPACT_WEEKS} weeks`}>
              {c.weekly.map((w) => (
                <li key={w.weekStart}>
                  <span>Week of {w.weekStart.slice(5)}</span>
                  <span className="bar" style={{ width: `${(w.packages / max) * 100}%` }} aria-hidden="true" />
                  <span className="n">{w.packages}</span>
                </li>
              ))}
            </ul>
            <p className="small muted">Active volunteers: people with at least one pickup assignment in the last {ACTIVE_VOLUNTEER_DAYS} days. Weeks start on Monday.</p>
          </section>
        );
      })}
    </>
  );
}
