"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { NEED_PRIORITIES } from "@/lib/types";
import type { BoardLine } from "@/lib/services/needs";
import type { Template } from "@/lib/services/templates";
import type { Item } from "@/lib/services/items";
import { ActionButton, Err, JsonForm, useRun } from "../forms";
import { Meter } from "../NeedsBoard";

const itemOptions = (items: Item[]): [string, string][] => items.map((i) => [i.id, `${i.name} (${i.unit})`]);
const PRIORITY_OPTIONS: [string, string][] = NEED_PRIORITIES.map((p) => [p, p[0].toUpperCase() + p.slice(1)]);

export function NeedsEditor({ slug, needs, items }: { slug: string; needs: BoardLine[]; items: Item[] }) {
  const live = needs.filter((n) => n.status !== "closed");
  const closed = needs.filter((n) => n.status === "closed" && n.source === "manual");
  return (
    <>
      <p className="muted">
        Needs come from two places: <b>standing needs</b> calculated from your package templates and current stock (they update on their own), and <b>posted needs</b> you add here for one-off asks.
      </p>
      <h3>Post a need</h3>
      <JsonForm
        idPrefix="need-new" url={`/api/chapters/${slug}/needs`} submit="Post need" success="Posted. It is on the public board now."
        fields={[
          { name: "itemId", label: "Item", type: "select", options: itemOptions(items) },
          { name: "quantity", label: "Quantity needed", type: "number", min: 1, max: 10000, required: true, defaultValue: 10 },
          { name: "priority", label: "Priority", type: "select", options: PRIORITY_OPTIONS, defaultValue: "normal" },
          { name: "note", label: "Note (public)", maxLength: 200, help: "Optional, shown on the board." },
        ]}
      />
      <h3>Current needs</h3>
      {live.length === 0 ? <p className="empty">No needs yet. Activate a package template or post a need.</p> : (
        <ul className="need-list">
          {live.map((n) => <NeedRow key={n.needId} n={n} />)}
        </ul>
      )}
      {closed.length > 0 && (
        <details>
          <summary>Closed posted needs ({closed.length})</summary>
          <ul className="need-list">{closed.map((n) => <NeedRow key={n.needId} n={n} />)}</ul>
        </details>
      )}
    </>
  );
}

function NeedRow({ n }: { n: BoardLine }) {
  const manual = n.source === "manual";
  return (
    <li>
      <div className="need-head">
        <span className="need-name">{n.itemName}</span>
        <span className="badge">{manual ? "Posted" : "Standing (from templates)"}</span>
        <span className="badge">{n.priority}</span>
        <span className={`status ${n.status === "met" ? "received" : n.status === "closed" ? "cancelled" : "scheduled"}`}>{n.status === "met" ? "Met" : n.status === "closed" ? "Closed" : "Open"}</span>
      </div>
      {n.note && <p className="need-note">{n.note}</p>}
      <Meter needed={n.needed} pledged={n.pledged} received={n.received} />
      <p className="figures"><span><b>{n.remaining}</b> still needed</span><span>needed {n.needed}</span><span>pledged {n.pledged}</span><span>received {n.received}</span></p>
      {manual && (
        <div className="row">
          {n.status === "closed" ? (
            <ActionButton label="Reopen" action={() => api("PATCH", `/api/needs/${n.needId}`, { status: "open" })} />
          ) : (
            <ActionButton label="Close need" confirm="Close this need? It disappears from the public board." action={() => api("PATCH", `/api/needs/${n.needId}`, { status: "closed" })} />
          )}
          <details>
            <summary className="small">Edit</summary>
            <JsonForm
              idPrefix={`need-${n.needId}`} url={`/api/needs/${n.needId}`} method="PATCH" submit="Save" reset={false}
              fields={[
                { name: "quantity", label: "Quantity", type: "number", min: 1, max: 10000, defaultValue: n.needed },
                { name: "priority", label: "Priority", type: "select", options: PRIORITY_OPTIONS, defaultValue: n.priority },
                { name: "note", label: "Note", maxLength: 200, defaultValue: n.note },
              ]}
            />
          </details>
        </div>
      )}
    </li>
  );
}

// ---- templates ---------------------------------------------------------------------------------------------------------

type Row = { itemId: string; quantity: number };

export function TemplateEditor({ slug, items, template }: { slug: string; items: Item[]; template?: Template }) {
  const { busy, error, run } = useRun();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [weeklyTarget, setWeeklyTarget] = useState(template?.weeklyTarget ?? 10);
  const [active, setActive] = useState(template?.active ?? true);
  const [rows, setRows] = useState<Row[]>(template?.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })) ?? [{ itemId: items[0]?.id ?? "", quantity: 1 }]);
  const [saved, setSaved] = useState(false);
  const idp = template ? `t-${template.id}` : "t-new";
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const body = { name, description, weeklyTarget, active, items: rows };
        const r = await run(() => (template ? api("PATCH", `/api/templates/${template.id}`, body) : api("POST", `/api/chapters/${slug}/templates`, body)));
        if (r !== undefined) setSaved(true);
      }}
    >
      <div className="fields">
        <div><label htmlFor={`${idp}-name`}>Template name</label><input id={`${idp}-name`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} /></div>
        <div><label htmlFor={`${idp}-target`}>Weekly target (packages)</label><input id={`${idp}-target`} type="number" min={0} max={1000} value={weeklyTarget} onChange={(e) => setWeeklyTarget(Number(e.target.value))} required /></div>
      </div>
      <label htmlFor={`${idp}-desc`}>Description</label>
      <input id={`${idp}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Active: its contents × weekly target feed the public needs board<span className="help">Inactive templates make no public claims.</span></span></label>
      <fieldset>
        <legend>Contents of one package</legend>
        {rows.map((r, i) => (
          <div className="inline" key={i} style={{ marginBottom: "0.4rem" }}>
            <div>
              <label htmlFor={`${idp}-i${i}`}>Item {i + 1}</label>
              <select id={`${idp}-i${i}`} value={r.itemId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
                {itemOptions(items).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${idp}-q${i}`}>Quantity</label>
              <input id={`${idp}-q${i}`} className="qty" type="number" min={1} max={50} value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
            </div>
            {rows.length > 1 && <button type="button" className="link-btn small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove item {i + 1}</button>}
          </div>
        ))}
        <button type="button" className="btn secondary small" onClick={() => setRows([...rows, { itemId: items[0]?.id ?? "", quantity: 1 }])}>Add an item</button>
      </fieldset>
      <Err text={error} />
      {saved && <p role="status" className="small">Saved.</p>}
      <p><button className="btn" disabled={busy}>{busy ? "Saving…" : template ? "Save template" : "Create template"}</button></p>
    </form>
  );
}

export function TemplatesTab({ slug, templates, items }: { slug: string; templates: Template[]; items: Item[] }) {
  return (
    <>
      <p className="muted">A template names the contents of one package and a weekly target. Active templates create the standing needs: <i>target packages left this week × contents − stock on hand</i>.</p>
      {templates.map((t) => (
        <details key={t.id} className="card" open={templates.length === 1}>
          <summary>{t.name} <span className={`status ${t.active ? "received" : ""}`}>{t.active ? "Active" : "Inactive"}</span> <span className="muted small">target {t.weeklyTarget}/week · {t.items.length} items</span></summary>
          <TemplateEditor slug={slug} items={items} template={t} />
        </details>
      ))}
      <h3>New template</h3>
      <TemplateEditor slug={slug} items={items} />
    </>
  );
}
