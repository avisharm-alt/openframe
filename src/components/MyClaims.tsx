"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatLocal, formatTime } from "@/lib/time";
import { CLAIM_STATUS_LABELS, CONCERN_CATEGORIES, CONCERN_LABELS, type ClaimStatus } from "@/lib/types";
import type { ClaimView } from "@/lib/services/claims";
import { ActionButton, Err, JsonForm, useRun } from "./forms";
import { WindowsEditor, emptyWindow, type WindowDraft } from "./WindowsEditor";
import { NEIGHBOUR_SAFETY } from "@/lib/copy";

type Zone = { id: string; name: string; description: string; hours: string };
type Details = { address: string; notes: string; phone: string; viewedAs: string };
const OPEN: ClaimStatus[] = ["claimed", "scheduled"];

export const windowText = (w: { startAt: string; endAt: string }, tz: string) => `${formatLocal(w.startAt, tz)} to ${formatTime(w.endAt, tz)}`;

function PrivateDetails({ pickupId, purged }: { pickupId: string; purged: boolean }) {
  const { busy, error, run } = useRun();
  const [d, setD] = useState<Details | null>(null);
  if (purged) return <p className="private small">Your pickup address, notes and phone number were erased after the pickup was finished.</p>;
  return (
    <div className="private">
      {d ? (
        <>
          <dl>
            <dt>Address</dt><dd>{d.address}</dd>
            {d.notes && (<><dt>Access notes</dt><dd>{d.notes}</dd></>)}
            {d.phone && (<><dt>Phone</dt><dd>{d.phone}</dd></>)}
          </dl>
          <p style={{ marginBottom: 0 }}><button type="button" className="link-btn small" onClick={() => setD(null)}>Hide my details</button></p>
        </>
      ) : (
        <>
          <p className="small" style={{ margin: "0 0 0.4rem" }}>Your address is hidden by default. Showing it is recorded in the audit log.</p>
          <button type="button" className="btn secondary small" disabled={busy} onClick={async () => { const r = await run(() => api<{ details: Details }>("GET", `/api/pickups/${pickupId}`), { refresh: false }); if (r) setD(r.details); }}>
            {busy ? "Loading…" : "Show my pickup details"}
          </button>
          <Err text={error} />
        </>
      )}
    </div>
  );
}

function Reschedule({ p, zones, today }: { p: ClaimView; zones: Zone[]; today: string }) {
  const { busy, error, run } = useRun();
  const [windows, setWindows] = useState<WindowDraft[]>([emptyWindow()]);
  if (p.method === "dropoff") {
    return (
      <JsonForm
        idPrefix={`rs-${p.id}`} url={`/api/claims/${p.id}`} method="PATCH" submit="Save new drop-off" success="Updated."
        fields={[
          { name: "zoneId", label: "Drop-off zone", type: "select", options: zones.map((z) => [z.id, z.name]), defaultValue: p.zone?.id },
          { name: "expectedDate", label: "Expected date", type: "date", required: true, defaultValue: p.expectedDate ?? "", min: undefined },
        ]}
        reset={false}
      />
    );
  }
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); await run(() => api("PATCH", `/api/claims/${p.id}`, { windows })); }}>
      <p className="small muted" style={{ marginTop: 0 }}>New windows replace your old ones. A coordinator will confirm one again.</p>
      <WindowsEditor value={windows} onChange={setWindows} idPrefix={`rw-${p.id}`} today={today} />
      <Err text={error} />
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save new windows"}</button></p>
    </form>
  );
}

function Concern({ p }: { p: ClaimView }) {
  return (
    <JsonForm
      idPrefix={`cn-${p.id}`} url="/api/reports" submit="Send to coordinators" success="Thank you. Your chapter’s coordinators will look at this."
      extra={{ claimId: p.id }}
      fields={[
        { name: "category", label: "What happened?", type: "select", options: CONCERN_CATEGORIES.map((c) => [c, CONCERN_LABELS[c]]) },
        { name: "details", label: "Details", type: "textarea", maxLength: 2000, help: "Optional. Please do not include anything about the people who receive items." },
      ]}
    />
  );
}

export function ClaimCard({ p, zones, today }: { p: ClaimView; zones: Zone[]; today: string }) {
  const open = OPEN.includes(p.status);
  const [panel, setPanel] = useState<"" | "reschedule" | "concern">("");
  const confirmed = p.pickup?.windows.find((w) => w.id === p.pickup!.scheduledWindowId);
  return (
    <article className="claim-card" aria-label={`Claim: ${p.request.label}, ${CLAIM_STATUS_LABELS[p.status]}`}>
      <h3>
        {p.quantity} × {p.request.label} <span className={`status ${p.status}`}>{CLAIM_STATUS_LABELS[p.status]}</span>
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {p.request.partnerName ? <>For {p.request.partnerName}, needed by {p.request.neededBy}.</> : <>Restocking {p.chapterName}’s fast stock.</>} {p.method === "pickup" ? "Pickup" : "Drop-off"}.
      </p>

      {p.delivered && (
        <div className="delivered-note" role="status">
          <b>✓ Delivered to {p.delivered.partnerName} on {formatLocal(p.delivered.at, p.timezone).split(",").slice(0, 2).join(",")}.</b>
          <span>{p.delivered.confirmed ? " Their staff confirmed it arrived." : " Their staff will hand it to someone who needs it."} Thank you for making that happen.</span>
        </div>
      )}
      {p.status === "received" && !p.delivered && p.wentToStock > 0 && (
        <p className="notice good" role="status">
          {p.wentToStock} {p.wentToStock === 1 ? "item" : "items"} went into our fast stock, ready for the next request. Thank you!
        </p>
      )}
      {p.status === "received" && !p.delivered && p.wentToStock === 0 && (p.receivedQuantity ?? 0) > 0 && p.request.status !== "cancelled" && (
        <p className="notice" role="status">We counted {p.receivedQuantity} in. They are on their way to {p.request.partnerName ?? "stock"}: you will see “Delivered” here when they arrive.</p>
      )}
      {p.status === "claimed" && p.releaseAt && (
        <p className="notice warn" role="status">Not scheduled yet. If a coordinator has not scheduled it by {formatLocal(p.releaseAt, p.timezone)}, it goes back on the board.</p>
      )}
      {p.status === "cancelled" && <p className="small muted">This claim was cancelled, so the request is open for others.</p>}

      {p.method === "dropoff" && p.zone && (
        <p>Drop off at <b>{p.zone.name}</b> on <b>{p.expectedDate}</b>. <span className="muted">{p.zone.description} {p.zone.hours}</span></p>
      )}
      {p.pickup && (
        <>
          {confirmed ? (
            <p>Confirmed window: <b>{windowText(confirmed, p.timezone)}</b>.{p.status === "scheduled" && " Two volunteers will come together and collect the items at your door."}</p>
          ) : (
            open && <p>Waiting for a coordinator to confirm one of your windows and assign two volunteers ({p.pickup.volunteerCount} of 2 assigned).</p>
          )}
          <details>
            <summary>Your preferred windows</summary>
            <ul>{p.pickup.windows.map((w) => <li key={w.id}>{windowText(w, p.timezone)}</li>)}</ul>
          </details>
          <PrivateDetails pickupId={p.pickup.id} purged={p.pickup.detailsPurged} />
          {open && <details><summary>Staying safe</summary><ul>{NEIGHBOUR_SAFETY.map((x) => <li key={x}>{x}</li>)}</ul></details>}
        </>
      )}

      <div className="row" style={{ marginTop: "0.8rem" }}>
        {open && (
          <>
            <button type="button" className="btn secondary small" aria-expanded={panel === "reschedule"} onClick={() => setPanel(panel === "reschedule" ? "" : "reschedule")}>Reschedule</button>
            <ActionButton label="Cancel claim" className="btn secondary small" confirm="Cancel this claim? The request goes back on the board." action={() => api("POST", `/api/claims/${p.id}/cancel`)} />
          </>
        )}
        {p.pickup && p.pickup.volunteerCount > 0 && (
          <button type="button" className="btn secondary small" aria-expanded={panel === "concern"} onClick={() => setPanel(panel === "concern" ? "" : "concern")}>Report a concern</button>
        )}
      </div>
      {panel === "reschedule" && <Reschedule p={p} zones={zones} today={today} />}
      {panel === "concern" && <Concern p={p} />}
    </article>
  );
}
