"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatDay, formatLocal } from "@/lib/time";
import { CLAIM_STATUS_LABELS, OUTCOME_REASONS, OUTCOME_REASON_LABELS } from "@/lib/types";
import type { Slot, VolunteerPickup } from "@/lib/services/pickups";
import type { DeliveryView } from "@/lib/services/deliveries";
import type { MyShift, Occurrence } from "@/lib/services/shifts";
import { ActionButton, Err, JsonForm, useRun } from "./forms";
import { windowText } from "./MyClaims";

type Details = { address: string; notes: string; phone: string };

function Address({ p }: { p: VolunteerPickup }) {
  const { busy, error, run } = useRun();
  const [d, setD] = useState<Details | null>(null);
  if (p.status !== "scheduled" && p.status !== "claimed") return <p className="small muted">This pickup is closed, so its address is no longer shown.</p>;
  if (!p.addressVisibleNow) {
    return (
      <p className="private small">
        {p.status === "claimed"
          ? "The address is shown once the pickup is scheduled with two volunteers, from 24 hours before the window."
          : p.visibleFrom ? <>The address appears here from <b>{formatLocal(p.visibleFrom, p.timezone)}</b> (24 hours before the window).</> : "The address appears here 24 hours before the window."}
      </p>
    );
  }
  return (
    <div className="private">
      {d ? (
        <>
          <dl>
            <dt>Address</dt><dd>{d.address}</dd>
            {d.notes && (<><dt>Access notes</dt><dd>{d.notes}</dd></>)}
            {d.phone && (<><dt>Phone</dt><dd>{d.phone}</dd></>)}
          </dl>
          <p className="small" style={{ margin: "0.5rem 0 0" }}>Private. Do not copy, photograph or share it. Collect at the door only: do not go inside.</p>
          <p style={{ marginBottom: 0 }}><button type="button" className="link-btn small" onClick={() => setD(null)}>Hide address</button></p>
        </>
      ) : (
        <>
          <button type="button" className="btn big" disabled={busy} onClick={async () => { const r = await run(() => api<{ details: Details }>("GET", `/api/pickups/${p.pickupId}`), { refresh: false }); if (r) setD(r.details); }}>
            {busy ? "Loading…" : "Show address"}
          </button>
          <p className="small" style={{ margin: "0.5rem 0 0" }}>Showing it is recorded in the audit log.</p>
          <Err text={error} />
        </>
      )}
    </div>
  );
}

function CouldNot({ p }: { p: VolunteerPickup }) {
  return (
    <JsonForm
      idPrefix={`cn-${p.pickupId}`} url={`/api/pickups/${p.pickupId}/complete`} submit="Confirm: couldn’t complete" extra={{ outcome: "could_not_complete" }} reset={false}
      fields={[
        { name: "reason", label: "Why?", type: "select", options: OUTCOME_REASONS.map((r) => [r, OUTCOME_REASON_LABELS[r]]), defaultValue: "nobody_home" },
        { name: "note", label: "Note", type: "textarea", maxLength: 300, help: "Required for “safety concern” and “something else”." },
      ]}
    />
  );
}

export function VolunteerCard({ p }: { p: VolunteerPickup }) {
  const [open, setOpen] = useState<"" | "couldnt" | "concern">("");
  const closed = p.status !== "claimed" && p.status !== "scheduled";
  return (
    <article className="vcard" aria-label={p.window ? `Pickup ${windowText(p.window, p.timezone)}` : "Pickup, window not confirmed"}>
      <p className="when">{p.window ? windowText(p.window, p.timezone) : "Window not confirmed yet"}</p>
      <p style={{ margin: "0 0 0.3rem" }}>
        <span className={`status ${p.status}`}>{CLAIM_STATUS_LABELS[p.status]}</span>{" "}
        <span className="muted">{p.chapterName} · {p.units} × {p.label}</span>
      </p>
      <p style={{ margin: "0.2rem 0" }}>
        {p.partners.length ? <>Going with <b>{p.partners.join(", ")}</b>.</> : <b>No partner assigned yet.</b>} Pickups are always in pairs.
      </p>
      <Address p={p} />
      {closed ? (
        <p className="small muted">{p.status === "collected" || p.status === "received" ? "Thank you. This pickup is complete." : `This pickup ended as “${CLAIM_STATUS_LABELS[p.status]}”.`}</p>
      ) : (
        <>
          <div className="actions">
            {p.status === "scheduled" && !p.arrivedAt && <ActionButton label="Arrived" className="btn big" action={() => api("POST", `/api/pickups/${p.pickupId}/arrive`)} />}
            {p.arrivedAt && !p.outcome && p.canCheckOut && <ActionButton label="Done (items collected)" className="btn big" action={() => api("POST", `/api/pickups/${p.pickupId}/complete`, { outcome: "collected" })} />}
            {p.canCheckOut && <button type="button" className="btn secondary big" aria-expanded={open === "couldnt"} onClick={() => setOpen(open === "couldnt" ? "" : "couldnt")}>Couldn’t complete</button>}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {p.status !== "scheduled" ? "Check-in opens once the pickup is scheduled with two volunteers." : p.arrivedAt ? <>You arrived at {formatLocal(p.arrivedAt, p.timezone)}. {p.outcome === "collected" && "You checked out: waiting for your partner."}</> : p.canArrive ? "Tap Arrived when you are at the door together." : "You can tap Arrived from one hour before the window, once two volunteers are assigned."}
          </p>
          {open === "couldnt" && <CouldNot p={p} />}
        </>
      )}
      <p style={{ marginBottom: 0 }}>
        <button type="button" className="link-btn small" aria-expanded={open === "concern"} onClick={() => setOpen(open === "concern" ? "" : "concern")}>Report a concern about this pickup</button>
      </p>
      {open === "concern" && (
        <JsonForm
          idPrefix={`rc-${p.pickupId}`} url="/api/reports" submit="Send to coordinators" extra={{ claimId: p.claimId }} success="Sent. Your coordinators will look at it."
          fields={[
            { name: "category", label: "What happened?", type: "select", options: [["safety", "I felt unsafe"], ["conduct", "Inappropriate behaviour"], ["no_show", "Someone did not show up"], ["other", "Something else"]] },
            { name: "details", label: "Details", type: "textarea", maxLength: 2000 },
          ]}
        />
      )}
    </article>
  );
}

export function SlotCard({ s }: { s: Slot }) {
  return (
    <article className="vcard" aria-label={`Open slot ${windowText(s.window, s.timezone)}`}>
      <p className="when">{windowText(s.window, s.timezone)}</p>
      <p className="muted" style={{ margin: "0 0 0.3rem" }}>{s.chapterName} · {s.units} × {s.label} · needs {s.volunteersNeeded} more volunteer{s.volunteersNeeded === 1 ? "" : "s"}</p>
      <p className="small muted" style={{ margin: 0 }}>The address is shown only after the pickup is scheduled, from 24 hours before.</p>
      <div className="actions"><ActionButton label="Sign up for this pickup" className="btn big" action={() => api("POST", `/api/pickups/${s.pickupId}/signup`)} /></div>
    </article>
  );
}

export function SafetyGate() {
  return (
    <div className="notice warn">
      <p><b>Before your first pickup, read and acknowledge the Safety rules.</b> Pairs only, daytime, doorstep handoff, and an emergency contact. Coordinators cannot assign you until you do.</p>
      <p style={{ marginBottom: 0 }}>
        <a className="btn secondary" href="/safety">Read the Safety rules</a>{" "}
        <ActionButton label="I have read them and will follow them" className="btn" action={() => api("POST", "/api/safety/ack")} />
      </p>
    </div>
  );
}

/** My weekly shifts, and the open ones I can sign up for. */
export function ShiftsSection({ mine, open }: { mine: MyShift[]; open: (Occurrence & { chapterSlug: string })[] }) {
  return (
    <>
      <h2>My shifts</h2>
      {mine.length === 0 ? <p className="empty">You are not signed up for any shifts yet.</p> : (
        <ul className="plain">
          {mine.map((m) => (
            <li key={m.slotId + m.date} className="shift">
              <span><b>{m.label}</b> · {formatDay(m.date)}, {m.start} to {m.end} <span className="muted">({m.chapterName})</span></span>
              <ActionButton label={`Cancel ${m.label} on ${m.date}`} className="link-btn small" confirm="Cancel this shift?" action={() => api("DELETE", `/api/shifts/${m.slotId}/signup?date=${m.date}`)} />
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Sign up for a shift ({open.length} open)</summary>
        {open.length === 0 ? <p className="empty">Every shift has the volunteers it needs.</p> : (
          <ul className="plain">
            {open.slice(0, 20).map((o) => (
              <li key={o.slotId + o.date} className="shift">
                <span><b>{o.label}</b> · {formatDay(o.date)}, {o.start} to {o.end} <span className="muted">needs {o.gap} more{o.periodLabel ? ` (${o.periodLabel})` : ""}</span></span>
                <ActionButton label={`Sign up for ${o.label} on ${o.date}`} className="btn small" action={() => api("POST", `/api/shifts/${o.slotId}/signup`, { date: o.date })} />
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}

/** My delivery batch: what to take where, and when the site can receive it. Items go to agency staff only. */
export function DeliveryCard({ d }: { d: DeliveryView }) {
  return (
    <article className="vcard" aria-label={`Delivery to ${d.site.name}`}>
      <p className="when">Delivery to {d.site.name}</p>
      <p style={{ margin: "0 0 0.3rem" }}>
        <span className={`status ${d.status === "completed" ? "received" : "scheduled"}`}>{d.status === "planned" ? "Planned" : d.status === "out" ? "Out for delivery" : "Delivered"}</span>{" "}
        <span className="muted">{d.site.partnerName} · planned for {formatDay(d.plannedFor)}</span>
      </p>
      <div className="private">
        <dl>
          <dt>Where</dt><dd>{d.site.address}</dd>
          <dt>Receiving hours</dt><dd>{d.site.receivingHours || "Ask your coordinator"}</dd>
        </dl>
      </div>
      <p className="small" style={{ margin: "0.4rem 0 0" }}><b>Take:</b></p>
      <ul style={{ margin: "0.2rem 0" }}>{d.requests.map((r) => <li key={r.id}>{r.label}</li>)}</ul>
      {d.volunteers.length > 1 && <p className="small muted" style={{ margin: 0 }}>With {d.volunteers.map((v) => v.name).join(", ")}.</p>}
      <p className="small" style={{ margin: "0.4rem 0 0" }}>Hand items to the agency’s staff at the door. Never to the people they serve, and never ask who receives them.</p>
      <div className="actions">
        {d.status === "planned" && <ActionButton label="Start delivery" className="btn big" action={() => api("POST", `/api/deliveries/${d.id}/start`)} />}
        {d.status === "out" && <ActionButton label="Delivered to the agency" className="btn big" action={() => api("POST", `/api/deliveries/${d.id}/complete`)} />}
      </div>
    </article>
  );
}
