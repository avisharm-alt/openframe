"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { addDays } from "@/lib/time";
import { CATEGORY_LABELS, ITEM_CATEGORIES, REQUEST_STATUS_LABELS, SIZES } from "@/lib/types";
import { REQUEST_WARNING } from "@/lib/copy";
import { REQUEST_NOTE_MAX } from "@/lib/validation";
import type { Item } from "@/lib/services/items";
import type { Favourite, RequestTemplate, RequestTriage } from "@/lib/services/requests";
import { ActionButton, Err, JsonForm, useRun } from "./forms";
import { formatDay } from "@/lib/time";

type Site = { id: string; name: string };
type Kit = { id: string; name: string };

/** Post a request in seconds: pick an item (and size), a quantity, a date and a site. Repeat the last one or tap a favourite to prefill. */
export function QuickRequestForm({ partnerId, sites, items, kits, last, favourites, today }: {
  partnerId: string; sites: Site[]; items: Item[]; kits: Kit[]; last: RequestTemplate | null; favourites: Favourite[]; today: string;
}) {
  const { busy, error, run, setError } = useRun();
  const [type, setType] = useState<"item" | "kit">("item");
  const [itemId, setItemId] = useState(last?.itemId ?? items[0]?.id ?? "");
  const [size, setSize] = useState(last?.size ?? "");
  const [kitId, setKitId] = useState(kits[0]?.id ?? "");
  const [quantity, setQuantity] = useState(last?.quantity ?? 1);
  const [neededBy, setNeededBy] = useState(addDays(today, 3));
  const [urgent, setUrgent] = useState(false);
  const [siteId, setSiteId] = useState(last?.siteId ?? sites[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const item = items.find((i) => i.id === itemId);
  const sizes = item ? SIZES[item.sizeScheme] : [];
  const byCategory = useMemo(() => ITEM_CATEGORIES.map((c) => [c, items.filter((i) => i.category === c)] as const).filter(([, l]) => l.length), [items]);

  const prefill = (t: { itemId: string; size: string; quantity: number; siteId: string | null; urgency: string }) => {
    setType("item");
    setItemId(t.itemId);
    setSize(t.size);
    setQuantity(t.quantity);
    if (t.siteId) setSiteId(t.siteId);
    setUrgent(t.urgency === "urgent");
    setDone(null);
  };
  const body = () =>
    type === "item"
      ? { type, partnerId, siteId, itemId, size: item?.sizeScheme === "none" ? "" : size, quantity, neededBy, urgency: urgent ? "urgent" : "normal", note }
      : { type, partnerId, siteId, kitTemplateId: kitId, quantity, neededBy, urgency: urgent ? "urgent" : "normal", note };

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setDone(null);
        const r = await run(() => api("POST", "/api/requests", body()));
        if (r !== undefined) { setDone("Posted. It is on the board now."); setNote(""); }
      }}
    >
      {(last || favourites.length > 0) && (
        <div className="quick" aria-label="Shortcuts">
          {last && <button type="button" className="btn secondary small" onClick={() => prefill(last)}>Repeat my last request</button>}
          {favourites.map((f) => (
            <span className="chip" key={f.id}>
              <button type="button" className="btn secondary small" onClick={() => prefill(f)}>{f.quantity} × {f.label}</button>
              <ActionButton label={`Remove favourite ${f.label}`} className="link-btn small" action={() => api("DELETE", `/api/favourites/${f.id}`)} />
            </span>
          ))}
        </div>
      )}

      {kits.length > 0 && (
        <fieldset>
          <legend>What are you asking for?</legend>
          <label className="check"><input type="radio" name="type" checked={type === "item"} onChange={() => setType("item")} /><span>A specific item</span></label>
          <label className="check"><input type="radio" name="type" checked={type === "kit"} onChange={() => setType("kit")} /><span>Ready-made kits (the student team assembles them)</span></label>
        </fieldset>
      )}

      {type === "item" ? (
        <>
          <label htmlFor="r-item">Item</label>
          <select id="r-item" value={itemId} onChange={(e) => { setItemId(e.target.value); setSize(""); }}>
            {byCategory.map(([c, list]) => (
              <optgroup key={c} label={CATEGORY_LABELS[c]}>{list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>
            ))}
          </select>
          {sizes.length > 0 && (
            <>
              <label htmlFor="r-size">Size</label>
              <select id="r-size" value={size} onChange={(e) => setSize(e.target.value)} required>
                <option value="">Choose a size…</option>
                {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </>
          )}
        </>
      ) : (
        <>
          <label htmlFor="r-kit">Kit</label>
          <select id="r-kit" value={kitId} onChange={(e) => setKitId(e.target.value)}>{kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
        </>
      )}

      <div className="fields">
        <div>
          <label htmlFor="r-qty">Quantity</label>
          <input id="r-qty" type="number" inputMode="numeric" min={1} max={type === "kit" ? 200 : 500} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))} required />
        </div>
        <div>
          <label htmlFor="r-date">Needed by</label>
          <input id="r-date" type="date" min={today} max={addDays(today, 60)} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} required />
        </div>
      </div>
      <div className="quick" aria-label="Needed-by shortcuts">
        {([["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["In a week", 7]] as const).map(([l, d]) => (
          <button type="button" className="btn secondary small" key={l} onClick={() => setNeededBy(addDays(today, d))}>{l}</button>
        ))}
      </div>

      <label className="check"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /><span>Urgent<span className="help">Shown first on the board. Use it when someone is waiting.</span></span></label>

      <label htmlFor="r-site">Deliver to</label>
      <select id="r-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <label htmlFor="r-note">Short note <span className="help">Optional, public, up to {REQUEST_NOTE_MAX} characters, for example “wide fit if possible”.</span></label>
      <input id="r-note" value={note} maxLength={REQUEST_NOTE_MAX} onChange={(e) => setNote(e.target.value)} aria-describedby="r-warn" />
      <p id="r-warn" className="notice warn small" role="note"><b>Keep it anonymous.</b> {REQUEST_WARNING}</p>

      <Err text={error} />
      {done && <p role="status" className="small">{done}</p>}
      <div className="actions">
        <button className="btn big" disabled={busy}>{busy ? "Posting…" : "Post request"}</button>
        {type === "item" && (
          <button
            type="button" className="btn secondary big" disabled={busy}
            onClick={async () => {
              setError(null);
              const r = await run(() => api("POST", `/api/partners/${partnerId}/favourites`, { itemId, size: item?.sizeScheme === "none" ? "" : size, quantity, siteId, urgency: urgent ? "urgent" : "normal" }));
              if (r !== undefined) setDone("Saved as a favourite.");
            }}
          >Save as favourite</button>
        )}
      </div>
    </form>
  );
}

const STATUS_CLASS: Record<string, string> = { open: "scheduled", claimed: "scheduled", in_transit: "scheduled", delivered: "received", confirmed: "received", cancelled: "cancelled", expired: "cancelled" };

/** "My partner's requests": status for each, with Confirm receipt on deliveries and Cancel while still open. */
export function PartnerRequests({ requests }: { requests: (RequestTriage & { canConfirm: boolean })[] }) {
  if (requests.length === 0) return <p className="empty">No requests yet. Post your first one above.</p>;
  return (
    <ul className="need-list">
      {requests.map((r) => (
        <li key={r.id}>
          <div className="need-head">
            <span className="need-name">{r.quantity} × {r.label}</span>
            <span className={`status ${STATUS_CLASS[r.status]}`}>{REQUEST_STATUS_LABELS[r.status]}</span>
            {r.urgency === "urgent" && <span className="badge urgent">Urgent</span>}
          </div>
          <p className="req-meta">Deliver to {r.siteName} · needed by {formatDay(r.neededBy)}{r.status === "open" || r.status === "claimed" ? ` · ${r.done + r.pending} of ${r.quantity} promised or in hand` : ""}</p>
          <div className="actions">
            {r.canConfirm && <ActionButton label="Confirm we received it" className="btn big" action={() => api("POST", `/api/requests/${r.id}/confirm`)} />}
            {(r.status === "open" || r.status === "claimed") && <ActionButton label="Cancel request" className="btn secondary" confirm="Cancel this request?" action={() => api("POST", `/api/requests/${r.id}/cancel`)} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** First step for a new agency worker: ask a partner for access, or apply for a new partner to be verified. */
export function PartnerAccess({ partners, chapters }: { partners: { id: string; name: string; chapterName: string }[]; chapters: { slug: string; name: string }[] }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "");
  return (
    <>
      <h2>Ask for access to a partner</h2>
      <p className="muted small">A student-team coordinator checks that you work there before you can post requests.</p>
      {partners.length === 0 ? <p className="empty">No verified partners yet. Apply below.</p> : (
        <div className="card">
          <label htmlFor="pa-partner" style={{ marginTop: 0 }}>Partner</label>
          <select id="pa-partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.chapterName})</option>)}
          </select>
          <p><ActionButton label="Request access" className="btn" action={() => api("POST", `/api/partners/${partnerId}/access`)} /></p>
        </div>
      )}
      <h2>Is your organisation not listed?</h2>
      <p className="muted small">Apply to become a verified partner. A coordinator will contact you before approving it.</p>
      <JsonForm
        idPrefix="apply" url="/api/partners/apply" submit="Apply as a partner" success="Applied. A coordinator will review it."
        fields={[
          { name: "chapter", label: "Chapter", type: "select", options: chapters.map((c) => [c.slug, c.name]) },
          { name: "name", label: "Organisation name", required: true, maxLength: 80 },
          { name: "description", label: "What you do", type: "textarea", maxLength: 300, help: "Public. Describe the organisation, never the people it serves." },
        ]}
      />
    </>
  );
}
