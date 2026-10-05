"use client";
import { ScrollTable } from "../ScrollTable";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatLocal } from "@/lib/time";
import { PLEDGE_STATUS_LABELS } from "@/lib/types";
import type { PickupBoard, PickupCard } from "@/lib/services/pickups";
import type { AwaitingReceipt, DropoffRow } from "@/lib/services/pledges";
import type { Member } from "@/lib/services/chapters";
import type { Item } from "@/lib/services/items";
import { ActionButton, Err, JsonForm, useRun } from "../forms";
import { windowText } from "../MyPledges";

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
  const { busy, error, run } = useRun();
  return (
    <article className={`card-sm${c.overdue ? " overdue" : ""}`} aria-label={`Pickup for ${c.donorName ?? "a deleted account"}`}>
      <h4>
        {c.donorName ?? "Former donor"} · {c.items}{" "}
        <span className={`status ${c.status}`}>{PLEDGE_STATUS_LABELS[c.status]}</span>{" "}
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
            {eligible.map((m) => <option key={m.userId} value={m.userId} disabled={!m.safetyAcknowledged}>{m.name}{m.safetyAcknowledged ? "" : " (has not acknowledged Safety rules)"}</option>)}
          </select>
        </div>
        <button className="btn small" disabled={busy || !pick}>Assign</button>
      </form>
      <Err text={error} />
      <CoordAddress card={c} tz={tz} />
      <details>
        <summary className="small">Close or cancel this pickup</summary>
        <JsonForm
          idPrefix={`st-${c.pickupId}`} url={`/api/pledges/${c.pledgeId}/status`} submit="Apply" reset={false}
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
    ["Unassigned", "unassigned", "Needs a confirmed window and two volunteers before it can be scheduled."],
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
            <tr key={r.pledgeId}>
              <td>{r.expectedDate}</td><td>{r.zoneName}</td><td>{r.donorName ?? "Former donor"}</td><td>{r.items}</td>
              <td><span className={`status ${r.status}`}>{PLEDGE_STATUS_LABELS[r.status]}</span></td>
              <td>
                <div className="row">
                  {r.status !== "collected" && <ActionButton label="Mark collected" action={() => api("POST", `/api/pledges/${r.pledgeId}/status`, { status: "collected" })} />}
                  <ActionButton label="No-show" confirm="Mark this drop-off as a no-show?" action={() => api("POST", `/api/pledges/${r.pledgeId}/status`, { status: "no_show" })} />
                  <ActionButton label="Cancel" confirm="Cancel this drop-off?" action={() => api("POST", `/api/pledges/${r.pledgeId}/status`, { status: "cancelled" })} />
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
  const [counts, setCounts] = useState<Record<string, number>>(Object.fromEntries(p.lines.map((l) => [l.lineId, l.quantity])));
  const [extraItem, setExtraItem] = useState("");
  const [extraQty, setExtraQty] = useState(1);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<number | null>(null);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = { lines: p.lines.map((l) => ({ lineId: l.lineId, quantity: counts[l.lineId] ?? 0 })), extras: extraItem ? [{ itemId: extraItem, quantity: extraQty }] : [], note };
        const r = await run(() => api<{ received: number }>("POST", `/api/pledges/${p.pledgeId}/receive`, body));
        if (r) setDone(r.received);
      }}
    >
      <h4 style={{ margin: "0 0 0.3rem" }}>
        {p.donorName ?? "Former donor"} · {p.method === "pickup" ? "collected pickup" : `drop-off${p.zoneName ? ` at ${p.zoneName}` : ""}${p.expectedDate ? `, ${p.expectedDate}` : ""}`}
      </h4>
      <p className="small muted" style={{ marginTop: 0 }}>Count what actually arrived. It can differ from the pledge (enter 0 for anything missing or unusable).</p>
      {p.lines.map((l) => (
        <div className="item-row" key={l.lineId}>
          <label htmlFor={`rc-${l.lineId}`}>{l.itemName} <span className="help">pledged {l.quantity} · {l.unit}</span></label>
          <input id={`rc-${l.lineId}`} type="number" min={0} max={10000} value={counts[l.lineId] ?? 0} onChange={(e) => setCounts({ ...counts, [l.lineId]: Math.max(0, Number(e.target.value)) })} />
        </div>
      ))}
      <div className="inline" style={{ marginTop: "0.7rem" }}>
        <div>
          <label htmlFor={`ex-${p.pledgeId}`}>Also received (not pledged)</label>
          <select id={`ex-${p.pledgeId}`} value={extraItem} onChange={(e) => setExtraItem(e.target.value)}>
            <option value="">None</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </select>
        </div>
        {extraItem && (
          <div>
            <label htmlFor={`exq-${p.pledgeId}`}>Quantity</label>
            <input id={`exq-${p.pledgeId}`} className="qty" type="number" min={1} value={extraQty} onChange={(e) => setExtraQty(Math.max(1, Number(e.target.value)))} />
          </div>
        )}
      </div>
      <label htmlFor={`nt-${p.pledgeId}`}>Note <span className="help">Optional, for example “two items were opened, discarded”.</span></label>
      <input id={`nt-${p.pledgeId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      <Err text={error} />
      {done !== null && <p role="status" className="small">Counted {done} items into stock.</p>}
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : "Count into stock"}</button></p>
    </form>
  );
}

export function ReceiveTab({ pledges, items }: { pledges: AwaitingReceipt[]; items: Item[] }) {
  if (pledges.length === 0) return <p className="empty">Nothing is waiting to be counted. Collected pickups and drop-offs that have arrived appear here.</p>;
  return <>{pledges.map((p) => <ReceiveCard key={p.pledgeId} p={p} items={items} />)}</>;
}
