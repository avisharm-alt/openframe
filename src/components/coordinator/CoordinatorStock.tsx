"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { CATEGORY_LABELS, SIZES } from "@/lib/types";
import type { LedgerRow, StockRow } from "@/lib/services/stock";
import type { Item } from "@/lib/services/items";
import type { Assemblable, KitTemplate } from "@/lib/services/kits";
import { Err, useRun } from "../forms";
import { ScrollTable } from "../ScrollTable";

const KIND_LABELS: Record<string, string> = { received: "Received", allocated_to_request: "Allocated to a request", assembled_into_kit: "Assembled into kit", adjusted: "Adjusted", discarded: "Discarded" };

function ItemSize({ items, itemId, size, setItemId, setSize, idp }: { items: Item[]; itemId: string; size: string; setItemId: (v: string) => void; setSize: (v: string) => void; idp: string }) {
  const item = items.find((i) => i.id === itemId);
  return (
    <>
      <div>
        <label htmlFor={`${idp}-item`}>Item</label>
        <select id={`${idp}-item`} value={itemId} onChange={(e) => { setItemId(e.target.value); setSize(""); }}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      {item && item.sizeScheme !== "none" && (
        <div>
          <label htmlFor={`${idp}-size`}>Size</label>
          <select id={`${idp}-size`} value={size} onChange={(e) => setSize(e.target.value)} required>
            <option value="">Size…</option>
            {SIZES[item.sizeScheme].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

function AdjustForm({ slug, items }: { slug: string; items: Item[] }) {
  const { busy, error, run } = useRun();
  const [kind, setKind] = useState<"adjusted" | "discarded">("adjusted");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [size, setSize] = useState("");
  const [n, setN] = useState(1);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const item = items.find((i) => i.id === itemId);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setDone(false);
        const sz = item?.sizeScheme === "none" ? "" : size;
        const body = kind === "adjusted" ? { kind, itemId, size: sz, delta: n, note } : { kind, itemId, size: sz, quantity: n, note };
        const r = await run(() => api("POST", `/api/chapters/${slug}/stock`, body));
        if (r !== undefined) { setDone(true); setNote(""); }
      }}
    >
      <div className="fields">
        <div>
          <label htmlFor="adj-kind">What happened?</label>
          <select id="adj-kind" value={kind} onChange={(e) => setKind(e.target.value as "adjusted" | "discarded")}>
            <option value="adjusted">Count or recount (add or remove)</option>
            <option value="discarded">Discard (spoiled or unusable)</option>
          </select>
        </div>
        <ItemSize items={items} itemId={itemId} size={size} setItemId={setItemId} setSize={setSize} idp="adj" />
        <div>
          <label htmlFor="adj-n">{kind === "adjusted" ? "Change" : "Quantity to discard"} <span className="help">{kind === "adjusted" ? "Negative removes stock." : "At least 1."}</span></label>
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

function TargetForm({ slug, items }: { slug: string; items: Item[] }) {
  const { busy, error, run } = useRun();
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [size, setSize] = useState("");
  const [target, setTarget] = useState(10);
  const [done, setDone] = useState(false);
  const item = items.find((i) => i.id === itemId);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setDone(false);
        const r = await run(() => api("PUT", `/api/chapters/${slug}/stock/targets`, { itemId, size: item?.sizeScheme === "none" ? "" : size, target }));
        if (r !== undefined) setDone(true);
      }}
    >
      <div className="fields">
        <ItemSize items={items} itemId={itemId} size={size} setItemId={setItemId} setSize={setSize} idp="tg" />
        <div>
          <label htmlFor="tg-n">Keep on the shelf <span className="help">0 removes the target.</span></label>
          <input id="tg-n" type="number" min={0} max={10000} value={target} onChange={(e) => setTarget(Number(e.target.value))} required />
        </div>
      </div>
      <Err text={error} />
      {done && <p role="status" className="small">Saved. If stock is below the target, a restock request is on the board now.</p>}
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : "Set restock target"}</button></p>
    </form>
  );
}

export function StockTab({ slug, stock, ledger, items }: { slug: string; stock: StockRow[]; ledger: LedgerRow[]; items: Item[] }) {
  const [all, setAll] = useState(false);
  const rows = stock.filter((r) => all || r.stock > 0 || r.target !== null);
  const below = rows.filter((r) => r.target !== null && r.stock < r.target).length;
  return (
    <>
      <p className="muted">
        Fast stock is a small shelf of essentials so common requests can be filled the same day. It is the sum of an append-only ledger and can never go below zero.
        {below > 0 ? <> <b>{below} item{below === 1 ? " is" : "s are"} below target</b>, so restock requests are on the public board.</> : null}
      </p>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Show items with no stock and no target</span></label>
      {rows.length === 0 ? <p className="empty">No stock yet. Count in a claim on the Receive tab, or record a count below.</p> : (
        <ScrollTable label="Fast stock">
          <table className="compact">
            <caption className="sr-only">Fast stock on hand and restock targets</caption>
            <thead><tr><th scope="col">Item</th><th scope="col">Size</th><th scope="col">Category</th><th scope="col">Stock</th><th scope="col">Restock target</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId + r.size}>
                  <td>{r.name}</td><td>{r.size || "–"}</td><td>{CATEGORY_LABELS[r.category]}</td><td>{r.stock} {r.unit}</td>
                  <td>{r.target === null ? "–" : <>{r.target}{r.stock < r.target ? <span className="status overdue" style={{ marginLeft: "0.4rem" }}>Below target</span> : <span className="status received" style={{ marginLeft: "0.4rem" }}>OK</span>}</>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
      <h3>Restock targets</h3>
      <p className="muted small">Below the target, the system posts a chapter “restock” request to the board, so neighbours always have something useful to claim between agency requests.</p>
      <TargetForm slug={slug} items={items} />
      <h3>Count or correct stock</h3>
      <AdjustForm slug={slug} items={items} />
      <h3>Recent ledger entries</h3>
      <ScrollTable label="Recent stock ledger entries">
        <table className="compact">
          <caption className="sr-only">Recent stock ledger entries</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col">Size</th><th scope="col">Change</th><th scope="col">Kind</th><th scope="col">Note</th></tr></thead>
          <tbody>{ledger.map((l) => <tr key={l.id}><td>{l.createdAt.slice(0, 16).replace("T", " ")}</td><td>{l.itemName}</td><td>{l.size || "–"}</td><td>{l.delta > 0 ? `+${l.delta}` : l.delta}</td><td>{KIND_LABELS[l.kind]}</td><td>{l.note}</td></tr>)}</tbody>
        </table>
      </ScrollTable>
    </>
  );
}

// ---- kits -----------------------------------------------------------------------------------------------------------------------------

function AssembleForm({ slug, a }: { slug: string; a: Assemblable }) {
  const { busy, error, run } = useRun();
  const [count, setCount] = useState(Math.min(1, a.maxKits) || 1);
  return (
    <form className="inline" onSubmit={async (e) => { e.preventDefault(); await run(() => api("POST", `/api/chapters/${slug}/kits`, { templateId: a.templateId, count })); }}>
      <div>
        <label htmlFor={`as-${a.templateId}`}>How many to assemble</label>
        <input id={`as-${a.templateId}`} className="qty" type="number" min={1} max={Math.max(1, a.maxKits)} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} />
      </div>
      <button className="btn" disabled={busy || a.maxKits < 1}>{busy ? "Assembling…" : "Assemble"}</button>
      <Err text={error} />
    </form>
  );
}

type Row = { itemId: string; size: string; quantity: number };

function TemplateEditor({ slug, items, template }: { slug: string; items: Item[]; template?: KitTemplate }) {
  const { busy, error, run } = useRun();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [active, setActive] = useState(template?.active ?? true);
  const [rows, setRows] = useState<Row[]>(template?.items.map((i) => ({ itemId: i.itemId, size: i.size, quantity: i.quantity })) ?? [{ itemId: items[0]?.id ?? "", size: "", quantity: 1 }]);
  const [saved, setSaved] = useState(false);
  const idp = template ? `kt-${template.id}` : "kt-new";
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const body = { name, description, active, items: rows.map((r) => ({ ...r, size: items.find((i) => i.id === r.itemId)?.sizeScheme === "none" ? "" : r.size })) };
        const r = await run(() => (template ? api("PATCH", `/api/kit-templates/${template.id}`, body) : api("POST", `/api/chapters/${slug}/kit-templates`, body)));
        if (r !== undefined) setSaved(true);
      }}
    >
      <label htmlFor={`${idp}-name`} style={{ marginTop: 0 }}>Kit name</label>
      <input id={`${idp}-name`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      <label htmlFor={`${idp}-desc`}>Description</label>
      <input id={`${idp}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Active: agency workers can request it, and you can assemble it</span></label>
      <fieldset>
        <legend>Contents of one kit</legend>
        {rows.map((r, i) => {
          const it = items.find((x) => x.id === r.itemId);
          return (
            <div className="inline" key={i} style={{ marginBottom: "0.4rem" }}>
              <div>
                <label htmlFor={`${idp}-i${i}`}>Item {i + 1}</label>
                <select id={`${idp}-i${i}`} value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value, size: "" })}>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              </div>
              {it && it.sizeScheme !== "none" && (
                <div>
                  <label htmlFor={`${idp}-s${i}`}>Size</label>
                  <select id={`${idp}-s${i}`} value={r.size} onChange={(e) => set(i, { size: e.target.value })} required><option value="">Size…</option>{SIZES[it.sizeScheme].map((s) => <option key={s} value={s}>{s}</option>)}</select>
                </div>
              )}
              <div>
                <label htmlFor={`${idp}-q${i}`}>Quantity</label>
                <input id={`${idp}-q${i}`} className="qty" type="number" min={1} max={50} value={r.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />
              </div>
              {rows.length > 1 && <button type="button" className="link-btn small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove item {i + 1}</button>}
            </div>
          );
        })}
        <button type="button" className="btn secondary small" onClick={() => setRows([...rows, { itemId: items[0]?.id ?? "", size: "", quantity: 1 }])}>Add an item</button>
      </fieldset>
      <Err text={error} />
      {saved && <p role="status" className="small">Saved.</p>}
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : template ? "Save kit" : "Create kit"}</button></p>
    </form>
  );
}

export function KitsTab({ slug, assemblable, templates, items }: { slug: string; assemblable: Assemblable[]; templates: KitTemplate[]; items: Item[] }) {
  return (
    <>
      <p className="muted">A kit template names the contents of one ready-made bag. Agency workers can request N kits; assemble them from stock here (nothing changes if anything is short), then fill the request from stock.</p>
      <h3>Assemble</h3>
      {assemblable.length === 0 ? <p className="empty">No active kit templates.</p> : assemblable.map((a) => (
        <div className="card" key={a.templateId}>
          <h4 style={{ margin: "0 0 0.3rem" }}>{a.name}: <span className="badge ok">{a.assembled} assembled</span> <span className={a.maxKits > 0 ? "badge ok" : "badge"}>{a.maxKits > 0 ? `can assemble ${a.maxKits} more` : "cannot be assembled yet"}</span></h4>
          {a.missing.length > 0 && <p className="small muted" style={{ marginTop: 0 }}>For the next kit we are short: {a.missing.map((m) => `${m.name}${m.size ? ` (${m.size})` : ""} ×${m.short}`).join(", ")}.</p>}
          <AssembleForm slug={slug} a={a} />
        </div>
      ))}
      <h3>Kit templates</h3>
      {templates.map((t) => (
        <details key={t.id} className="card">
          <summary>{t.name} <span className={`status ${t.active ? "received" : ""}`}>{t.active ? "Active" : "Inactive"}</span> <span className="muted small">{t.items.length} items</span></summary>
          <TemplateEditor slug={slug} items={items} template={t} />
        </details>
      ))}
      <h3>New kit template</h3>
      <TemplateEditor slug={slug} items={items} />
    </>
  );
}
