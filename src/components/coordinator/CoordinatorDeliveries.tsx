"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type { Deliverable, DeliveryView } from "@/lib/services/deliveries";
import type { Member } from "@/lib/services/chapters";
import { formatDay } from "@/lib/time";
import { ActionButton, Err, useRun } from "../forms";

/** Requests that are in hand, grouped by delivery site: tick some and plan a delivery run. */
export function Deliverables({ slug, rows, today }: { slug: string; rows: Deliverable[]; today: string }) {
  const bySite = useMemo(() => {
    const m = new Map<string, { siteName: string; partnerName: string; items: Deliverable[] }>();
    for (const r of rows) m.set(r.siteId, { siteName: r.siteName, partnerName: r.partnerName, items: [...(m.get(r.siteId)?.items ?? []), r] });
    return [...m.entries()];
  }, [rows]);
  if (rows.length === 0) return <p className="empty">Nothing is waiting for a delivery run. Requests appear here once they are in hand.</p>;
  return <>{bySite.map(([siteId, s]) => <SitePlan key={siteId} slug={slug} siteId={siteId} site={s} today={today} />)}</>;
}

function SitePlan({ slug, siteId, site, today }: { slug: string; siteId: string; site: { siteName: string; partnerName: string; items: Deliverable[] }; today: string }) {
  const { busy, error, run } = useRun();
  const [chosen, setChosen] = useState<Set<string>>(new Set(site.items.map((i) => i.requestId)));
  const [date, setDate] = useState(today);
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); await run(() => api("POST", `/api/chapters/${slug}/deliveries`, { siteId, requestIds: [...chosen], plannedFor: date })); }}>
      <h4 style={{ margin: "0 0 0.3rem" }}>{site.siteName} <span className="muted small">{site.partnerName}</span></h4>
      <fieldset>
        <legend>Include in this run</legend>
        {site.items.map((i) => (
          <label className="check" key={i.requestId}>
            <input type="checkbox" checked={chosen.has(i.requestId)} onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(i.requestId); else n.delete(i.requestId); setChosen(n); }} />
            <span>{i.label} <span className="muted small">needed by {formatDay(i.neededBy)}{i.urgency === "urgent" ? " · urgent" : ""}</span></span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={`dd-${siteId}`}>Planned for</label>
      <input id={`dd-${siteId}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      <Err text={error} />
      <p><button className="btn" disabled={busy || chosen.size === 0}>{busy ? "Planning…" : `Plan delivery of ${chosen.size}`}</button></p>
    </form>
  );
}

/** Planned and recent delivery runs: assign volunteers, start, complete. Shows the site's receiving hours. */
export function DeliveryList({ deliveries, roster }: { deliveries: DeliveryView[]; roster: Member[] }) {
  if (deliveries.length === 0) return <p className="empty">No delivery runs yet.</p>;
  return <>{deliveries.map((d) => <DeliveryRow key={d.id} d={d} roster={roster} />)}</>;
}

function DeliveryRow({ d, roster }: { d: DeliveryView; roster: Member[] }) {
  const { busy, error, run } = useRun();
  const [pick, setPick] = useState("");
  const taken = new Set(d.volunteers.map((v) => v.id));
  return (
    <article className="card-sm" aria-label={`Delivery to ${d.site.name}`}>
      <h4>
        {d.site.name} · {formatDay(d.plannedFor)} <span className={`status ${d.status === "completed" ? "received" : "scheduled"}`}>{d.status === "planned" ? "Planned" : d.status === "out" ? "Out" : "Delivered"}</span>
      </h4>
      <p className="small" style={{ margin: "0.2rem 0" }}>{d.site.address} · receiving hours: {d.site.receivingHours || "not set"}</p>
      <ul style={{ margin: "0.2rem 0 0.4rem" }}>{d.requests.map((r) => <li key={r.id}>{r.label}</li>)}</ul>
      <p className="small" style={{ margin: "0.2rem 0" }}><b>Volunteers:</b> {d.volunteers.length === 0 ? "none yet" : d.volunteers.map((v) => v.name).join(", ")}</p>
      {d.status === "planned" && (
        <form className="inline" onSubmit={async (e) => { e.preventDefault(); if (pick) await run(() => api("POST", `/api/deliveries/${d.id}/assign`, { volunteerId: pick })); setPick(""); }}>
          <div>
            <label htmlFor={`dv-${d.id}`}>Assign a volunteer</label>
            <select id={`dv-${d.id}`} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {roster.filter((m) => !taken.has(m.userId)).map((m) => <option key={m.userId} value={m.userId} disabled={!m.safetyAcknowledged}>{m.name}{m.safetyAcknowledged ? "" : " (has not acknowledged Safety rules)"}</option>)}
            </select>
          </div>
          <button className="btn small" disabled={busy || !pick}>Assign</button>
        </form>
      )}
      <Err text={error} />
      <div className="row" style={{ marginTop: "0.4rem" }}>
        {d.status === "planned" && <ActionButton label="Mark out for delivery" className="btn" action={() => api("POST", `/api/deliveries/${d.id}/start`)} />}
        {d.status === "out" && <ActionButton label="Mark delivered to the agency" className="btn" action={() => api("POST", `/api/deliveries/${d.id}/complete`)} />}
      </div>
    </article>
  );
}
