"use client";
import { WINDOW_EARLIEST, WINDOW_LATEST } from "@/lib/types";

export type WindowDraft = { date: string; start: string; end: string };
export const emptyWindow = (): WindowDraft => ({ date: "", start: "10:00", end: "12:00" });

/** Up to three preferred pickup windows: a date and a daytime start and end (9:00 a.m. to 8:00 p.m., local time). */
export function WindowsEditor({ value, onChange, idPrefix, today }: { value: WindowDraft[]; onChange: (v: WindowDraft[]) => void; idPrefix: string; today: string }) {
  const set = (i: number, patch: Partial<WindowDraft>) => onChange(value.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <fieldset>
      <legend>Preferred pickup windows</legend>
      <p className="help" style={{ marginTop: "0.3rem" }}>
        Pick one to three windows when someone will be at your door. Volunteers only do daytime pickups, so windows run between 9:00 a.m. and 8:00 p.m. and must start at least 12 hours from now.
      </p>
      {value.map((w, i) => (
        <div className="fields" key={i} role="group" aria-label={`Window ${i + 1}`}>
          <div>
            <label htmlFor={`${idPrefix}-d${i}`}>Date</label>
            <input id={`${idPrefix}-d${i}`} type="date" min={today} value={w.date} onChange={(e) => set(i, { date: e.target.value })} required />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-s${i}`}>From</label>
            <input id={`${idPrefix}-s${i}`} type="time" min={WINDOW_EARLIEST} max={WINDOW_LATEST} value={w.start} onChange={(e) => set(i, { start: e.target.value })} required />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-e${i}`}>To</label>
            <input id={`${idPrefix}-e${i}`} type="time" min={WINDOW_EARLIEST} max={WINDOW_LATEST} value={w.end} onChange={(e) => set(i, { end: e.target.value })} required />
          </div>
          {value.length > 1 && (
            <div style={{ alignSelf: "end" }}>
              <button type="button" className="link-btn small" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove window {i + 1}</button>
            </div>
          )}
        </div>
      ))}
      {value.length < 3 && (
        <p><button type="button" className="btn secondary small" onClick={() => onChange([...value, emptyWindow()])}>Add another window</button></p>
      )}
    </fieldset>
  );
}
