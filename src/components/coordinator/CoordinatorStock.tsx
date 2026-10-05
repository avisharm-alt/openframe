"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { CATEGORY_LABELS } from "@/lib/types";
import type { InventoryRow, LedgerRow } from "@/lib/services/inventory";
import type { Assemblable, PackageRow } from "@/lib/services/packages";
import type { Partner } from "@/lib/services/partners";
import { Err, useRun } from "../forms";

const KIND_LABELS: Record<string, string> = { received: "Received", assembled_into_package: "Assembled into package", adjusted: "Adjusted", discarded: "Discarded" };

function AdjustForm({ slug, inventory }: { slug: string; inventory: InventoryRow[] }) {
  const { busy, error, run } = useRun();
  const [kind, setKind] = useState<"adjusted" | "discarded">("adjusted");
  const [itemId, setItemId] = useState(inventory[0]?.itemId ?? "");
  const [n, setN] = useState(1);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setDone(false);
        const body = kind === "adjusted" ? { kind, itemId, delta: n, note } : { kind, itemId, quantity: n, note };
        const r = await run(() => api("POST", `/api/chapters/${slug}/inventory`, body));
        if (r !== undefined) { setDone(true); setNote(""); }
      }}
    >
      <div className="fields">
        <div>
          <label htmlFor="adj-kind">What happened?</label>
          <select id="adj-kind" value={kind} onChange={(e) => setKind(e.target.value as "adjusted" | "discarded")}>
            <option value="adjusted">Recount (add or remove)</option>
            <option value="discarded">Discard (spoiled or unusable)</option>
          </select>
        </div>
        <div>
          <label htmlFor="adj-item">Item</label>
          <select id="adj-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {inventory.map((i) => <option key={i.itemId} value={i.itemId}>{i.name} (now {i.stock})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="adj-n">{kind === "adjusted" ? "Change" : "Quantity to discard"} <span className="help">{kind === "adjusted" ? "Negative removes stock." : "Whole number, at least 1."}</span></label>
          <input id="adj-n" type="number" value={n} min={kind === "discarded" ? 1 : undefined} onChange={(e) => setN(Number(e.target.value))} required />
        </div>
      </div>
      <label htmlFor="adj-note">Note <span className="help">Required: say why.</span></label>
      <input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} required />
      <Err text={error} />
      {done && <p role="status" className="small">Recorded in the ledger.</p>}
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : "Record"}</button></p>
    </form>
  );
}

export function InventoryTab({ slug, inventory, ledger }: { slug: string; inventory: InventoryRow[]; ledger: LedgerRow[] }) {
  const [all, setAll] = useState(false);
  const rows = inventory.filter((r) => all || r.stock > 0);
  return (
    <>
      <p className="muted">Stock is the sum of an append-only ledger: every change below is a row, and stock can never go below zero.</p>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Show items with no stock</span></label>
      {rows.length === 0 ? <p className="empty">No stock yet. Count in a pledge on the Receive tab.</p> : (
        <div className="table-wrap">
          <table className="compact">
            <caption className="sr-only">Stock on hand</caption>
            <thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Stock</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.itemId}><td>{r.name}</td><td>{CATEGORY_LABELS[r.category]}</td><td>{r.stock} {r.unit}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <h3>Correct stock</h3>
      <AdjustForm slug={slug} inventory={inventory} />
      <h3>Recent ledger entries</h3>
      <div className="table-wrap">
        <table className="compact">
          <caption className="sr-only">Recent inventory ledger entries</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col">Change</th><th scope="col">Kind</th><th scope="col">Note</th></tr></thead>
          <tbody>{ledger.map((l) => <tr key={l.id}><td>{l.createdAt.slice(0, 16).replace("T", " ")}</td><td>{l.itemName}</td><td>{l.delta > 0 ? `+${l.delta}` : l.delta}</td><td>{KIND_LABELS[l.kind]}</td><td>{l.note}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function AssembleForm({ slug, a }: { slug: string; a: Assemblable }) {
  const { busy, error, run } = useRun();
  const [count, setCount] = useState(Math.min(1, a.maxPackages) || 1);
  return (
    <form className="inline" onSubmit={async (e) => { e.preventDefault(); await run(() => api("POST", `/api/chapters/${slug}/packages`, { templateId: a.templateId, count })); }}>
      <div>
        <label htmlFor={`as-${a.templateId}`}>How many to assemble</label>
        <input id={`as-${a.templateId}`} className="qty" type="number" min={1} max={Math.max(1, a.maxPackages)} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} />
      </div>
      <button className="btn" disabled={busy || a.maxPackages < 1}>{busy ? "Assembling…" : "Assemble"}</button>
      <Err text={error} />
    </form>
  );
}

export function PackagesTab({ slug, assemblable, assembled, handedOff, partners, today }: { slug: string; assemblable: Assemblable[]; assembled: PackageRow[]; handedOff: PackageRow[]; partners: Partner[]; today: string }) {
  const { busy, error, run } = useRun();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [agencyId, setAgencyId] = useState(partners.find((p) => p.active && p.acceptsPackages)?.id ?? "");
  const [date, setDate] = useState(today);
  const accepting = partners.filter((p) => p.active && p.acceptsPackages);
  return (
    <>
      <h3>Assemble from a template</h3>
      <p className="muted small">Assembling takes the contents out of stock in one step. If anything is short, nothing changes.</p>
      {assemblable.length === 0 ? <p className="empty">No active templates.</p> : (
        assemblable.map((a) => (
          <div className="card" key={a.templateId}>
            <h4 style={{ margin: "0 0 0.3rem" }}>{a.name}: <span className={a.maxPackages > 0 ? "badge ok" : "badge"}>{a.maxPackages > 0 ? `can assemble ${a.maxPackages} now` : "cannot be assembled yet"}</span></h4>
            {a.missing.length > 0 && <p className="small muted" style={{ marginTop: 0 }}>For the next package we are short: {a.missing.map((m) => `${m.name} (${m.short})`).join(", ")}.</p>}
            <AssembleForm slug={slug} a={a} />
          </div>
        ))
      )}

      <h3>Assembled, ready to hand off ({assembled.length})</h3>
      {assembled.length === 0 ? <p className="empty">No assembled packages waiting.</p> : (
        <form onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api("POST", `/api/chapters/${slug}/packages/handoff`, { packageIds: [...chosen], agencyId, date })); if (r) setChosen(new Set()); }}>
          <fieldset>
            <legend>Choose packages</legend>
            <label className="check"><input type="checkbox" checked={chosen.size === assembled.length} onChange={(e) => setChosen(e.target.checked ? new Set(assembled.map((p) => p.id)) : new Set())} /><span>Select all ({assembled.length})</span></label>
            {assembled.map((p, i) => (
              <label className="check" key={p.id}>
                <input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(p.id); else n.delete(p.id); setChosen(n); }} />
                <span>{p.templateName} #{assembled.length - i} <span className="muted small">assembled {p.assembledAt.slice(0, 10)}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="fields">
            <div>
              <label htmlFor="ho-agency">Partner agency</label>
              <select id="ho-agency" value={agencyId} onChange={(e) => setAgencyId(e.target.value)} required>
                {accepting.length === 0 && <option value="">No partner is accepting packages</option>}
                {accepting.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ho-date">Date handed off</label>
              <input id="ho-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <p className="small muted">We record the agency and the date only. Never enter anything about the people who receive packages.</p>
          <Err text={error} />
          <p><button className="btn" disabled={busy || chosen.size === 0 || !agencyId}>{busy ? "Saving…" : `Hand off ${chosen.size} package${chosen.size === 1 ? "" : "s"}`}</button></p>
        </form>
      )}

      <h3>Recently handed off</h3>
      {handedOff.length === 0 ? <p className="empty">None yet.</p> : (
        <div className="table-wrap">
          <table className="compact">
            <caption className="sr-only">Packages handed off</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Package</th><th scope="col">Partner agency</th></tr></thead>
            <tbody>{handedOff.slice(0, 25).map((p) => <tr key={p.id}><td>{p.handedOffOn}</td><td>{p.templateName}</td><td>{p.agencyName}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
