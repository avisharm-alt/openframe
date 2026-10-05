import Link from "next/link";
import type { BoardCard } from "@/lib/services/requests";
import { formatDay } from "@/lib/time";

/** One request on the live board. Restock requests (the chapter's own) look different from agency requests. */
export function RequestCard({ c, claimHref }: { c: BoardCard; claimHref?: string }) {
  const restock = c.type === "restock";
  return (
    <li className={`req${restock ? " restock" : ""}`}>
      <div className="need-head">
        <h3 className="need-name">{c.label}</h3>
        {c.urgency === "urgent" && <span className="badge urgent">Urgent</span>}
        {restock && <span className="badge restock">Student team restock</span>}
        {c.type === "kit" && <span className="badge">Ready-made kits</span>}
        {c.type !== "kit" && <span className="badge">{c.newOnly ? "New only" : "New or clean"}</span>}
      </div>
      <p className="req-main">
        <b>{c.remaining}</b> {c.unit === "each" || c.unit === "kit" ? (c.remaining === 1 ? "needed" : "needed") : `${c.unit} needed`}
        {c.remaining < c.quantity && <span className="muted"> (of {c.quantity})</span>}
        {" · "}needed by <b>{formatDay(c.neededBy)}</b>
      </p>
      <p className="req-meta">
        {restock ? "Keeps our fast stock ready, so common requests are filled the same day." : <>For <b>{c.partnerName}</b>, delivered to {c.siteName}.</>}
      </p>
      {c.note && <p className="need-note">{c.note}</p>}
      {c.excluded && <p className="small muted">{c.partnerName} cannot accept: {c.excluded}</p>}
      <p className="req-action">
        {c.claimable && claimHref ? <Link className="btn" href={claimHref}>Claim this</Link> : !c.claimable ? <span className="small muted">The student team fills this one from stock.</span> : null}
      </p>
    </li>
  );
}
