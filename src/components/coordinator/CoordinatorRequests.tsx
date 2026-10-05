"use client";
import { api } from "@/lib/api-client";
import { REQUEST_STATUS_LABELS } from "@/lib/types";
import type { RequestTriage } from "@/lib/services/requests";
import { formatDay } from "@/lib/time";
import { ActionButton } from "../forms";

const STATUS_CLASS: Record<string, string> = { open: "scheduled", claimed: "scheduled", in_transit: "scheduled", delivered: "received" };

/** Triage: live requests first, at-risk ones (needed-by approaching and still unfilled) highlighted, each with "Fill from stock". */
export function RequestsTriage({ rows }: { rows: RequestTriage[] }) {
  const live = rows.filter((r) => r.status === "open" || r.status === "claimed");
  const inHand = rows.filter((r) => r.status === "in_transit" || r.status === "delivered");
  const risk = live.filter((r) => r.atRisk).length;
  return (
    <>
      <p className="muted">
        Requests that still need filling, most at risk first. <b>Fill from stock</b> takes the units off the shelf and sends the request straight to delivery. {risk > 0 ? <b>{risk} request{risk === 1 ? " is" : "s are"} at risk of missing the needed-by date.</b> : "Nothing is at risk right now."}
      </p>
      {live.length === 0 ? <p className="empty">No open requests.</p> : live.map((r) => <Row key={r.id} r={r} />)}
      {inHand.length > 0 && (
        <>
          <h3>In hand or delivered</h3>
          <p className="small muted">On its way to the agency, or delivered and waiting for the agency worker to confirm. Group the on-its-way ones into a run on the Deliveries tab.</p>
          {inHand.map((r) => <Row key={r.id} r={r} />)}
        </>
      )}
    </>
  );
}

function Row({ r }: { r: RequestTriage }) {
  const live = r.status === "open" || r.status === "claimed";
  return (
    <article className={`card-sm${r.atRisk ? " overdue" : ""}`} aria-label={`${r.label} for ${r.partnerName ?? "restock"}`}>
      <h4>
        {r.quantity} × {r.label} <span className={`status ${STATUS_CLASS[r.status] ?? ""}`}>{REQUEST_STATUS_LABELS[r.status]}</span>{" "}
        {r.urgency === "urgent" && <span className="badge urgent">Urgent</span>} {r.type === "restock" && <span className="badge restock">Restock</span>}{" "}
        {r.atRisk && <span className="status overdue">{r.overdue ? `Overdue by ${-r.daysLeft} day${r.daysLeft === -1 ? "" : "s"}` : `At risk: ${r.daysLeft === 0 ? "needed today" : `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`}`}</span>}
      </h4>
      <p className="small" style={{ margin: "0.2rem 0" }}>
        {r.partnerName ? <>For <b>{r.partnerName}</b> → {r.siteName}</> : "The chapter’s own restock request"} · needed by {formatDay(r.neededBy)}
        {live && <> · {r.done} in hand, {r.pending} promised by neighbours, <b>{r.remaining}</b> unclaimed</>}
      </p>
      {r.note && <p className="small muted" style={{ margin: "0.2rem 0" }}>“{r.note}”</p>}
      {live && (
        <div className="row" style={{ marginTop: "0.4rem" }}>
          {r.type !== "restock" && (
            <ActionButton
              label={r.canFill ? `Fill from stock (${r.stockAvailable} on the shelf)` : `Fill from stock (only ${r.stockAvailable} on the shelf)`}
              className={r.canFill ? "btn" : "btn secondary"} action={() => api("POST", `/api/requests/${r.id}/fill`)}
            />
          )}
          <ActionButton label="Cancel request" className="btn secondary small" confirm="Cancel this request? Neighbours who have not handed anything over are released." action={() => api("POST", `/api/requests/${r.id}/cancel`)} />
        </div>
      )}
    </article>
  );
}
