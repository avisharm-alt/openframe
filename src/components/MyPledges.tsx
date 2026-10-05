"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatLocal, formatTime } from "@/lib/time";
import { PLEDGE_STATUS_LABELS, CONCERN_CATEGORIES, CONCERN_LABELS, type PledgeStatus } from "@/lib/types";
import type { PledgeView } from "@/lib/services/pledges";
import { ActionButton, Err, JsonForm, useRun } from "./forms";
import { WindowsEditor, emptyWindow, type WindowDraft } from "./WindowsEditor";
import { DONOR_SAFETY } from "@/lib/copy";

type Zone = { id: string; name: string; description: string; hours: string };
type Details = { address: string; notes: string; phone: string; viewedAs: string };
const OPEN: PledgeStatus[] = ["pledged", "scheduled"];

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

function Reschedule({ p, zones, today }: { p: PledgeView; zones: Zone[]; today: string }) {
  const { busy, error, run } = useRun();
  const [windows, setWindows] = useState<WindowDraft[]>([emptyWindow()]);
  if (p.method === "dropoff") {
    return (
      <JsonForm
        idPrefix={`rs-${p.id}`} url={`/api/pledges/${p.id}`} method="PATCH" submit="Save new drop-off" success="Updated."
        fields={[
          { name: "zoneId", label: "Drop-off zone", type: "select", options: zones.map((z) => [z.id, z.name]), defaultValue: p.zone?.id },
          { name: "expectedDate", label: "Expected date", type: "date", required: true, defaultValue: p.expectedDate ?? "", min: undefined },
        ]}
        reset={false}
      />
    );
  }
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); await run(() => api("PATCH", `/api/pledges/${p.id}`, { windows })); }}>
      <p className="small muted" style={{ marginTop: 0 }}>New windows replace your old ones. A coordinator will confirm one again.</p>
      <WindowsEditor value={windows} onChange={setWindows} idPrefix={`rw-${p.id}`} today={today} />
      <Err text={error} />
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save new windows"}</button></p>
    </form>
  );
}

function Concern({ p }: { p: PledgeView }) {
  return (
    <JsonForm
      idPrefix={`cn-${p.id}`} url="/api/reports" submit="Send to coordinators" success="Thank you. Your chapter’s coordinators will look at this."
      extra={{ pledgeId: p.id }}
      fields={[
        { name: "category", label: "What happened?", type: "select", options: CONCERN_CATEGORIES.map((c) => [c, CONCERN_LABELS[c]]) },
        { name: "details", label: "Details", type: "textarea", maxLength: 2000, help: "Optional. Please do not include anything about the people who receive packages." },
      ]}
    />
  );
}

export function PledgeCard({ p, zones, today }: { p: PledgeView; zones: Zone[]; today: string }) {
  const open = OPEN.includes(p.status);
  const [panel, setPanel] = useState<"" | "reschedule" | "concern">("");
  const confirmed = p.pickup?.windows.find((w) => w.id === p.pickup!.scheduledWindowId);
  return (
    <article className="pledge" aria-label={`Pledge to ${p.chapterName}, ${p.method}, ${PLEDGE_STATUS_LABELS[p.status]}`}>
      <h3>
        {p.chapterName} · {p.method === "pickup" ? "Pickup" : "Drop-off"} <span className={`status ${p.status}`}>{PLEDGE_STATUS_LABELS[p.status]}</span>
      </h3>
      <ul>
        {p.items.filter((l) => l.quantity > 0 || (l.receivedQuantity ?? 0) > 0).map((l) => (
          <li key={l.lineId}>
            {l.quantity > 0 ? `${l.quantity} × ` : ""}{l.itemName}
            {l.receivedQuantity !== null && <span className="muted"> · received {l.receivedQuantity}</span>}
          </li>
        ))}
      </ul>

      {p.method === "dropoff" && p.zone && (
        <p>Drop off at <b>{p.zone.name}</b> on <b>{p.expectedDate}</b>. <span className="muted">{p.zone.description} {p.zone.hours}</span></p>
      )}
      {p.pickup && (
        <>
          {confirmed ? (
            <p>Confirmed window: <b>{windowText(confirmed, p.timezone)}</b>.{p.status === "scheduled" && " Two volunteers will come together and collect the items at your door."}</p>
          ) : (
            open && (
              <p>
                Waiting for a coordinator to confirm one of your windows and assign two volunteers ({p.pickup.volunteerCount} of 2 assigned).
              </p>
            )
          )}
          <details>
            <summary>Your preferred windows</summary>
            <ul>{p.pickup.windows.map((w) => <li key={w.id}>{windowText(w, p.timezone)}</li>)}</ul>
          </details>
          <PrivateDetails pickupId={p.pickup.id} purged={p.pickup.detailsPurged} />
          {open && <details><summary>Staying safe</summary><ul>{DONOR_SAFETY.map((x) => <li key={x}>{x}</li>)}</ul></details>}
        </>
      )}

      <div className="row" style={{ marginTop: "0.8rem" }}>
        {open && (
          <>
            <button type="button" className="btn secondary small" aria-expanded={panel === "reschedule"} onClick={() => setPanel(panel === "reschedule" ? "" : "reschedule")}>Reschedule</button>
            <ActionButton label="Cancel pledge" className="btn secondary small" confirm="Cancel this pledge?" action={() => api("POST", `/api/pledges/${p.id}/cancel`)} />
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
