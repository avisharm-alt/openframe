"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Err, explain } from "./forms";
import { WindowsEditor, emptyWindow, type WindowDraft } from "./WindowsEditor";
import { ACCEPTED, DROPOFF_NOTE, NEW_ONLY_NOTE, NOT_ACCEPTED, PICKUP_NOTE } from "@/lib/copy";

type Line = { needId: string; itemName: string; unit: string; remaining: number; newOnly: boolean; note: string };
type Zone = { id: string; name: string; description: string; hours: string };

export function PledgeForm({ chapter, lines, zones, today }: { chapter: { slug: string; name: string }; lines: Line[]; zones: Zone[]; today: string }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<"pickup" | "dropoff">(zones.length ? "dropoff" : "pickup");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [expectedDate, setExpectedDate] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [windows, setWindows] = useState<WindowDraft[]>([emptyWindow()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = lines.filter((l) => (qty[l.needId] ?? 0) > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (chosen.length === 0) return setError("Choose at least one item and a quantity.");
    setBusy(true);
    try {
      const items = chosen.map((l) => ({ needId: l.needId, quantity: qty[l.needId] }));
      const body = method === "pickup" ? { chapter: chapter.slug, method, items, address, notes, phone, windows } : { chapter: chapter.slug, method, items, zoneId, expectedDate };
      await api("POST", "/api/pledges", body);
      router.push("/pledges?new=1");
      router.refresh();
    } catch (err) {
      setError(explain(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate={false}>
      <div className="notice rules" role="note">
        <b>Before you pledge: what we accept</b>
        <div className="cols" style={{ marginTop: "0.4rem" }}>
          <div><b className="small">Yes, please</b><ul>{ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul></div>
          <div><b className="small">We can’t accept</b><ul>{NOT_ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul></div>
        </div>
        <p className="small" style={{ marginBottom: 0 }}>{NEW_ONLY_NOTE}</p>
      </div>

      <h2>1. What can you give?</h2>
      <p className="muted small">Only items someone needs right now are listed, and you can pledge up to the amount still needed.</p>
      {lines.length === 0 ? (
        <p className="notice" role="status">Nothing is needed in {chapter.name} right now. Thank you for checking.</p>
      ) : (
        <div>
          {lines.map((l) => {
            const id = `q-${l.needId}`;
            return (
              <div className="item-row" key={l.needId}>
                <div>
                  <label htmlFor={id}>{l.itemName}</label>
                  <span className="help" id={`${id}-h`}>{l.remaining} {l.unit} still needed · {l.newOnly ? "new only" : "new, or clean and in good condition"}{l.note ? ` · ${l.note}` : ""}</span>
                </div>
                <input id={id} className="qty" type="number" inputMode="numeric" min={0} max={l.remaining} value={qty[l.needId] ?? ""} placeholder="0" aria-describedby={`${id}-h`}
                  onChange={(e) => setQty({ ...qty, [l.needId]: e.target.value === "" ? 0 : Math.max(0, Math.min(l.remaining, Math.floor(Number(e.target.value)))) })} />
              </div>
            );
          })}
        </div>
      )}

      <h2>2. How will you get it to us?</h2>
      <fieldset>
        <legend>Pickup or drop-off</legend>
        <label className="choice">
          <input type="radio" name="method" value="dropoff" checked={method === "dropoff"} onChange={() => setMethod("dropoff")} disabled={zones.length === 0} />
          <span><b>Drop off at a public zone</b>{zones.length === 0 ? "No drop-off zones are set up yet." : DROPOFF_NOTE}</span>
        </label>
        <label className="choice">
          <input type="radio" name="method" value="pickup" checked={method === "pickup"} onChange={() => setMethod("pickup")} />
          <span><b>Pickup from my address</b>{PICKUP_NOTE}</span>
        </label>
      </fieldset>

      {method === "dropoff" ? (
        <div className="fields">
          <div>
            <label htmlFor="zone">Drop-off zone</label>
            <select id="zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)} required aria-describedby="zone-h">
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <span className="help" id="zone-h">{zones.find((z) => z.id === zoneId)?.description} {zones.find((z) => z.id === zoneId)?.hours}</span>
          </div>
          <div>
            <label htmlFor="expected">Expected date</label>
            <input id="expected" type="date" min={today} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} required />
          </div>
        </div>
      ) : (
        <>
          <label htmlFor="address">Pickup address <span className="help">Encrypted. Shown only to you, your chapter’s coordinators and the two assigned volunteers, and erased after the pickup.</span></label>
          <input id="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} required minLength={5} maxLength={300} autoComplete="street-address" />
          <label htmlFor="notes">Access notes <span className="help">Optional. For example “buzzer 7B”. Do not include anything you would not want a volunteer to know.</span></label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} style={{ minHeight: "4.5rem" }} />
          <label htmlFor="phone">Phone <span className="help">Optional. Only used if volunteers cannot find you at the door.</span></label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} autoComplete="tel" />
          <WindowsEditor value={windows} onChange={setWindows} idPrefix="win" today={today} />
        </>
      )}

      <Err text={error} />
      <p style={{ marginTop: "1.2rem" }}>
        <button className="btn big" disabled={busy || lines.length === 0}>{busy ? "Sending…" : "Confirm pledge"}</button>
        <span className="small muted" style={{ marginLeft: "0.8rem" }}>{chosen.length} item type{chosen.length === 1 ? "" : "s"} selected</span>
      </p>
    </form>
  );
}
