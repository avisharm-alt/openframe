"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatLocal } from "@/lib/time";
import { OUTCOME_REASONS, OUTCOME_REASON_LABELS, PLEDGE_STATUS_LABELS } from "@/lib/types";
import type { Slot, VolunteerPickup } from "@/lib/services/pickups";
import { ActionButton, Err, JsonForm, useRun } from "./forms";
import { windowText } from "./MyPledges";

type Details = { address: string; notes: string; phone: string };

function Address({ p }: { p: VolunteerPickup }) {
  const { busy, error, run } = useRun();
  const [d, setD] = useState<Details | null>(null);
  if (p.status !== "scheduled" && p.status !== "pledged") return <p className="small muted">This pickup is closed, so its address is no longer shown.</p>;
  if (!p.addressVisibleNow) {
    return (
      <p className="private small">
        {p.status === "pledged"
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
  const closed = p.status !== "pledged" && p.status !== "scheduled";
  return (
    <article className="vcard" aria-label={p.window ? `Pickup ${windowText(p.window, p.timezone)}` : "Pickup, window not confirmed"}>
      <p className="when">{p.window ? windowText(p.window, p.timezone) : "Window not confirmed yet"}</p>
      <p style={{ margin: "0 0 0.3rem" }}>
        <span className={`status ${p.status}`}>{PLEDGE_STATUS_LABELS[p.status]}</span>{" "}
        <span className="muted">{p.chapterName} · {p.units} item{p.units === 1 ? "" : "s"}</span>
      </p>
      <p style={{ margin: "0.2rem 0" }}>
        {p.partners.length ? <>Going with <b>{p.partners.join(", ")}</b>.</> : <b>No partner assigned yet.</b>} Pickups are always in pairs.
      </p>
      <Address p={p} />
      {closed ? (
        <p className="small muted">{p.status === "collected" || p.status === "received" ? "Thank you. This pickup is complete." : `This pickup ended as “${PLEDGE_STATUS_LABELS[p.status]}”.`}</p>
      ) : (
        <>
          <div className="actions">
            {!p.arrivedAt && <ActionButton label="Arrived" className="btn big" action={() => api("POST", `/api/pickups/${p.pickupId}/arrive`)} />}
            {p.arrivedAt && !p.outcome && p.canCheckOut && <ActionButton label="Done (items collected)" className="btn big" action={() => api("POST", `/api/pickups/${p.pickupId}/complete`, { outcome: "collected" })} />}
            {p.canCheckOut && <button type="button" className="btn secondary big" aria-expanded={open === "couldnt"} onClick={() => setOpen(open === "couldnt" ? "" : "couldnt")}>Couldn’t complete</button>}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {p.arrivedAt ? <>You arrived at {formatLocal(p.arrivedAt, p.timezone)}. {p.outcome === "collected" && "You checked out: waiting for your partner."}</> : p.canArrive ? "Tap Arrived when you are at the door together." : "You can tap Arrived from one hour before the window, once two volunteers are assigned."}
          </p>
          {open === "couldnt" && <CouldNot p={p} />}
        </>
      )}
      <p style={{ marginBottom: 0 }}>
        <button type="button" className="link-btn small" aria-expanded={open === "concern"} onClick={() => setOpen(open === "concern" ? "" : "concern")}>Report a concern about this pickup</button>
      </p>
      {open === "concern" && (
        <JsonForm
          idPrefix={`rc-${p.pickupId}`} url="/api/reports" submit="Send to coordinators" extra={{ pledgeId: p.pledgeId }} success="Sent. Your coordinators will look at it."
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
      <p className="muted" style={{ margin: "0 0 0.3rem" }}>{s.chapterName} · {s.units} item{s.units === 1 ? "" : "s"} · needs {s.volunteersNeeded} more volunteer{s.volunteersNeeded === 1 ? "" : "s"}</p>
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
