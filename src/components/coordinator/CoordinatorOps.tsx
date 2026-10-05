"use client";
import { ScrollTable } from "../ScrollTable";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatLocal } from "@/lib/time";
import { CLAIM_STATUS_LABELS, SIZES } from "@/lib/types";
import type { PickupBoard, PickupCard } from "@/lib/services/pickups";
import type { AwaitingReceipt, DropoffRow } from "@/lib/services/claims";
import type { Member } from "@/lib/services/chapters";
import type { Item } from "@/lib/services/items";
import { ActionButton, Err, JsonForm, useRun } from "../forms";
import { windowText } from "../MyClaims";

function CoordAddress({ card, tz }: { card: PickupCard; tz: string }) {
  const { busy, error, run } = useRun();
  const [d, setD] = useState<{ address: string; notes: string; phone: string } | null>(null);
  const visible = card.visibleFrom && new Date(card.visibleFrom) <= new Date();
  if (!visible) return <p className="private small">Address available to coordinators from {card.visibleFrom ? formatLocal(card.visibleFrom, tz) : "the window"} (24 hours before).</p>;
  return (
    <div className="private">
      {d ? (
        <>
          <dl><dt>Address</dt><dd>{d.address}</dd>{d.notes && (<><dt>Notes</dt><dd>{d.notes}</dd></>)}{d.phone && (<><dt>Phone</dt><dd>{d.phone}</dd></>)}</dl>
          <p style={{ margin: "0.4rem 0 0" }}><button type="button" className="link-btn small" onClick={() => setD(null)}>Hide</button></p>
        </>
      ) : (
        <>
          <button type="button" className="btn secondary small" disabled={busy} onClick={async () => { const r = await run(() => api<{ details: { address: string; notes: string; phone: string } }>("GET", `/api/pickups/${card.pickupId}`), { refresh: false }); if (r) setD(r.details); }}>{busy ? "Loading…" : "Show address (logged)"}</button>
          <Err text={error} />
        </>
      )}
    </div>
  );
}

function Card({ c, roster, tz }: { c: PickupCard; roster: Member[]; tz: string }) {
  const assigned = new Set(c.volunteers.map((v) => v.id));
  const eligible = roster.filter((m) => !assigned.has(m.userId));
  const [pick, setPick] = useState("");
  const suggested = c.suggested.map((v) => roster.find((m) => m.userId === v.id)).filter((m): m is Member => !!m && m.safetyAcknowledged);
  const { busy, error, run } = useRun();
  return (
    <article className={`card-sm${c.overdue ? " overdue" : ""}`} aria-label={`Pickup for ${c.neighbourName ?? "a deleted account"}`}>
      <h4>
        {c.neighbourName ?? "Former neighbour"} · {c.items}{" "}
        <span className={`status ${c.status}`}>{CLAIM_STATUS_LABELS[c.status]}</span>{" "}
        {c.overdue && <span className="status overdue">Overdue</span>}
      </h4>
      <p className="small" style={{ margin: "0.2rem 0" }}><b>Windows</b></p>
      <ul style={{ margin: "0 0 0.4rem" }}>
        {c.windows.map((w) => (
          <li key={w.id}>
            {windowText(w, tz)}{" "}
            {c.confirmedWindowId === w.id ? <span className="badge ok">Confirmed</span> : !c.confirmedWindowId && (
              <ActionButton label="Confirm this window" className="btn secondary small" action={() => api("POST", `/api/pickups/${c.pickupId}/window`, { windowId: w.id })} />
            )}
          </li>
        ))}
      </ul>
      <p className="small" style={{ margin: "0.2rem 0" }}><b>Volunteers ({c.volunteers.length}/2 needed)</b></p>
      {c.volunteers.length === 0 ? <p className="empty small" style={{ margin: 0 }}>None assigned.</p> : (
        <ul style={{ margin: "0 0 0.4rem" }}>
          {c.volunteers.map((v) => (
            <li key={v.id}>
              {v.name}{v.arrivedAt && <span className="muted"> · arrived {formatLocal(v.arrivedAt, tz)}</span>}{v.outcome && <span className="muted"> · {v.outcome === "collected" ? "done" : "could not complete"}</span>}{" "}
              <ActionButton label={`Remove ${v.name}`} className="link-btn small" confirm={`Remove ${v.name} from this pickup?`} action={() => api("DELETE", `/api/pickups/${c.pickupId}/assign/${v.id}`)} />
            </li>
          ))}
        </ul>
      )}
      <form className="inline" onSubmit={async (e) => { e.preventDefault(); if (pick) await run(() => api("POST", `/api/pickups/${c.pickupId}/assign`, { volunteerId: pick })); setPick(""); }}>
        <div>
          <label htmlFor={`as-${c.pickupId}`}>Assign a volunteer</label>
          <select id={`as-${c.pickupId}`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose…</option>
            {eligible.map((m) => <option key={m.userId} value={m.userId} disabled={!m.safetyAcknowledged}>{m.name}{m.safetyAcknowledged ? (c.suggested.some((x) => x.id === m.userId) ? " (on shift)" : "") : " (has not acknowledged Safety rules)"}</option>)}
          </select>
        </div>
        <button className="btn small" disabled={busy || !pick}>Assign</button>
      </form>
      {suggested.length > 0 && (
        <p className="small" style={{ margin: "0.4rem 0 0" }}>
          <b>On the matching shift:</b> {suggested.map((m) => m.name).join(", ")}.{" "}
          {c.volunteers.length < 2 && suggested.length > 0 && (
            <button
              type="button" className="btn secondary small" disabled={busy}
              onClick={async () => { for (const m of suggested.slice(0, 2 - c.volunteers.length)) await run(() => api("POST", `/api/pickups/${c.pickupId}/assign`, { volunteerId: m.userId })); }}
            >Assign suggested {Math.min(2 - c.volunteers.length, suggested.length) === 1 ? "volunteer" : "pair"}</button>
          )}
        </p>
      )}
      <Err text={error} />
      <CoordAddress card={c} tz={tz} />
      <details>
        <summary className="small">Close or cancel this pickup</summary>
        <JsonForm
          idPrefix={`st-${c.pickupId}`} url={`/api/claims/${c.claimId}/status`} submit="Apply" reset={false}
          fields={[
            { name: "status", label: "Set status", type: "select", options: [["cancelled", "Cancelled"], ["no_show", "No-show"], ["collected", "Collected (volunteers could not check out)"]], defaultValue: "cancelled" },
            { name: "reason", label: "Reason", maxLength: 200, help: "Required when closing as collected." },
          ]}
        />
      </details>
    </article>
  );
}

export function PickupBoardView({ board, roster, tz }: { board: PickupBoard; roster: Member[]; tz: string }) {
  const sections: [string, keyof PickupBoard, string][] = [
    ["Overdue", "overdue", "Window ended more than 2 hours ago and the pickup is not closed. Check in with the volunteers."],
    ["Today", "today", "Scheduled for today."],
    ["Unassigned", "unassigned", "Needs a confirmed window and two volunteers before it can be scheduled. Unscheduled claims are released after 48 hours."],
    ["Scheduled", "scheduled", "Two volunteers and a window are confirmed."],
  ];
  return (
    <div className="board-cols">
      {sections.map(([title, key, help]) => (
        <section key={key} aria-labelledby={`pb-${key}`}>
          <h3 id={`pb-${key}`} style={{ marginTop: 0 }}>{title} <span className="muted small">({board[key].length})</span></h3>
          <p className="small muted" style={{ marginTop: 0 }}>{help}</p>
          {board[key].length === 0 ? <p className="empty small">None.</p> : board[key].map((c) => <Card key={c.pickupId} c={c} roster={roster} tz={tz} />)}
        </section>
      ))}
    </div>
  );
}

export function DropoffsTable({ rows }: { rows: DropoffRow[] }) {
  if (rows.length === 0) return <p className="empty">No incoming drop-offs.</p>;
  return (
    <ScrollTable label="Incoming drop-offs by date and zone">
      <table className="compact">
        <caption className="sr-only">Incoming drop-offs by date and zone</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Zone</th><th scope="col">From</th><th scope="col">Items</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.claimId}>
              <td>{r.expectedDate}</td><td>{r.zoneName}</td><td>{r.neighbourName ?? "Former neighbour"}</td><td>{r.items}</td>
              <td><span className={`status ${r.status}`}>{CLAIM_STATUS_LABELS[r.status]}</span></td>
              <td>
                <div className="row">
                  {r.status !== "collected" && <ActionButton label="Mark collected" action={() => api("POST", `/api/claims/${r.claimId}/status`, { status: "collected" })} />}
                  <ActionButton label="No-show" confirm="Mark this drop-off as a no-show?" action={() => api("POST", `/api/claims/${r.claimId}/status`, { status: "no_show" })} />
                  <ActionButton label="Cancel" confirm="Cancel this drop-off?" action={() => api("POST", `/api/claims/${r.claimId}/status`, { status: "cancelled" })} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function ReceiveCard({ p, items }: { p: AwaitingReceipt; items: Item[] }) {
  const { busy, error, run } = useRun();
  const [quantity, setQuantity] = useState(p.quantity);
  const [extraItem, setExtraItem] = useState("");
  const [extraSize, setExtraSize] = useState("");
  const [extraQty, setExtraQty] = useState(1);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const extra = items.find((i) => i.id === extraItem);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = { quantity, extras: extraItem ? [{ itemId: extraItem, size: extra?.sizeScheme === "none" ? "" : extraSize, quantity: extraQty }] : [], note };
        const r = await run(() => api<{ received: number; allocatedToRequest: number }>("POST", `/api/claims/${p.claimId}/receive`, body));
        if (r) setDone(`Counted ${r.received}. ${r.allocatedToRequest} went to the request, the rest to stock.`);
      }}
    >
      <h4 style={{ margin: "0 0 0.3rem" }}>
        {p.neighbourName ?? "Former neighbour"} · {p.method === "pickup" ? "collected pickup" : `drop-off${p.zoneName ? ` at ${p.zoneName}` : ""}${p.expectedDate ? `, ${p.expectedDate}` : ""}`}
      </h4>
      <p className="small muted" style={{ marginTop: 0 }}>Claimed {p.quantity} × {p.label}{p.partnerName ? ` for ${p.partnerName}` : " (restock)"}. Count what actually arrived: it can differ (enter 0 for none). Items the request no longer needs go to stock.</p>
      <label htmlFor={`rq-${p.claimId}`}>Received <span className="help">Claimed {p.quantity}</span></label>
      <input id={`rq-${p.claimId}`} className="qty" type="number" min={0} max={10000} value={quantity} onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))} />
      <div className="inline" style={{ marginTop: "0.7rem" }}>
        <div>
          <label htmlFor={`ex-${p.claimId}`}>Also received (not claimed)</label>
          <select id={`ex-${p.claimId}`} value={extraItem} onChange={(e) => { setExtraItem(e.target.value); setExtraSize(""); }}>
            <option value="">None</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        {extra && extra.sizeScheme !== "none" && (
          <div>
            <label htmlFor={`exs-${p.claimId}`}>Size</label>
            <select id={`exs-${p.claimId}`} value={extraSize} onChange={(e) => setExtraSize(e.target.value)} required><option value="">Size…</option>{SIZES[extra.sizeScheme].map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
        )}
        {extraItem && (
          <div>
            <label htmlFor={`exq-${p.claimId}`}>Quantity</label>
            <input id={`exq-${p.claimId}`} className="qty" type="number" min={1} value={extraQty} onChange={(e) => setExtraQty(Math.max(1, Number(e.target.value)))} />
          </div>
        )}
      </div>
      <label htmlFor={`nt-${p.claimId}`}>Note <span className="help">Optional, for example “one pair was the wrong size”.</span></label>
      <input id={`nt-${p.claimId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      <Err text={error} />
      {done && <p role="status" className="small">{done}</p>}
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : "Count into stock"}</button></p>
    </form>
  );
}

export function ReceiveTab({ claims, items }: { claims: AwaitingReceipt[]; items: Item[] }) {
  if (claims.length === 0) return <p className="empty">Nothing is waiting to be counted. Collected pickups and drop-offs that have arrived appear here.</p>;
  return <>{claims.map((p) => <ReceiveCard key={p.claimId} p={p} items={items} />)}</>;
}
