"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Err, explain } from "./forms";
import { WindowsEditor, emptyWindow, type WindowDraft } from "./WindowsEditor";
import { ACCEPTED, DROPOFF_NOTE, NEW_ONLY_NOTE, NOT_ACCEPTED, PICKUP_NOTE, RELEASE_NOTE } from "@/lib/copy";

type Zone = { id: string; name: string; description: string; hours: string };

export function ClaimForm({ requestId, remaining, label, neededBy, excluded, partnerName, zones, today, maxDate }: {
  requestId: string; remaining: number; label: string; neededBy: string; excluded: string; partnerName: string | null; zones: Zone[]; today: string; maxDate: string;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(remaining);
  const [method, setMethod] = useState<"pickup" | "dropoff">(zones.length ? "dropoff" : "pickup");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [expectedDate, setExpectedDate] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [windows, setWindows] = useState<WindowDraft[]>([emptyWindow()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = method === "pickup" ? { requestId, quantity, method, address, notes, phone, windows } : { requestId, quantity, method, zoneId, expectedDate };
      await api("POST", "/api/claims", body);
      router.push("/claims?new=1");
      router.refresh();
    } catch (err) {
      setError(explain(err));
      setBusy(false);
    }
  }
  const zone = zones.find((z) => z.id === zoneId);
  return (
    <form onSubmit={submit}>
      <div className="notice rules" role="note">
        <b>Before you claim: what we accept</b>
        <div className="cols" style={{ marginTop: "0.4rem" }}>
          <div><b className="small">Yes, please</b><ul>{ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul></div>
          <div><b className="small">We can’t accept</b><ul>{NOT_ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul></div>
        </div>
        {excluded && <p className="small"><b>{partnerName ?? "This partner"} also cannot accept:</b> {excluded}</p>}
        <p className="small" style={{ marginBottom: 0 }}>{NEW_ONLY_NOTE}</p>
      </div>

      <h2>1. How many will you give?</h2>
      <label htmlFor="qty">Quantity of “{label}” <span className="help">Up to {remaining} are still needed. You can claim part of the request.</span></label>
      <input id="qty" className="qty" type="number" inputMode="numeric" min={1} max={remaining} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(remaining, Math.floor(Number(e.target.value) || 1))))} required />

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
            <span className="help" id="zone-h">{zone?.description} {zone?.hours}</span>
          </div>
          <div>
            <label htmlFor="expected">Drop-off date <span className="help">Needed by {neededBy}.</span></label>
            <input id="expected" type="date" min={today} max={maxDate} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} required />
          </div>
        </div>
      ) : (
        <>
          <label htmlFor="address">Pickup address <span className="help">Encrypted. Shown only to you, your chapter’s coordinators and the two assigned volunteers, and erased after the pickup.</span></label>
          <input id="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} required minLength={5} maxLength={300} autoComplete="street-address" />
          <label htmlFor="notes">Access notes <span className="help">Optional. For example “buzzer 7B”.</span></label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} style={{ minHeight: "4.5rem" }} />
          <label htmlFor="phone">Phone <span className="help">Optional. Only used if volunteers cannot find you at the door.</span></label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} autoComplete="tel" />
          <WindowsEditor value={windows} onChange={setWindows} idPrefix="win" today={today} />
          <p className="small muted">Pick windows on or before {neededBy}, when this is needed.</p>
        </>
      )}
      <p className="notice" role="note">{RELEASE_NOTE}</p>
      <Err text={error} />
      <p style={{ marginTop: "1.2rem" }}><button className="btn big" disabled={busy}>{busy ? "Sending…" : "Confirm claim"}</button></p>
    </form>
  );
}
