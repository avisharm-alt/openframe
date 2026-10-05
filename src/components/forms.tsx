"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";

/** Runs an async action with busy and error state, then refreshes the server-rendered page. */
export function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>, opts: { refresh?: boolean } = {}): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (opts.refresh !== false) router.refresh();
      return r;
    } catch (e) {
      setError(explain(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function explain(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details;
    if (e.status === 422 && Array.isArray(d) && d.length) {
      return d.map((i: { path?: string; message?: string }) => (i.path ? `${i.path}: ` : "") + (i.message ?? "invalid")).join(" · ");
    }
    return e.message;
  }
  return "Something went wrong. Please try again.";
}

export const Err = ({ text, id }: { text: string | null; id?: string }) =>
  text ? <p role="alert" id={id} className="field-error">{text}</p> : null;

/** A button that calls the API (or any async function), shows errors under itself and refreshes the page. */
export function ActionButton({
  label, busyLabel, action, className = "btn secondary small", confirm, onDone,
}: {
  label: string; busyLabel?: string; action: () => Promise<unknown>; className?: string; confirm?: string; onDone?: (r: unknown) => void;
}) {
  const { busy, error, run } = useRun();
  return (
    <span>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          const r = await run(action);
          if (r !== undefined) onDone?.(r);
        }}
      >
        {busy ? busyLabel ?? "Working…" : label}
      </button>
      <Err text={error} />
    </span>
  );
}

export type Field = {
  name: string; label: string; type?: "text" | "number" | "textarea" | "select" | "checkbox" | "date" | "email";
  options?: [string, string][]; help?: string; required?: boolean; defaultValue?: string | number | boolean;
  min?: number; max?: number; maxLength?: number; placeholder?: string;
};

/** A small JSON form: builds the request body from its fields (plus `extra`), sends it, shows errors, refreshes. */
export function JsonForm({
  fields, url, method = "POST", submit, extra = {}, success, reset = true, idPrefix, compact,
}: {
  fields: Field[]; url: string; method?: string; submit: string; extra?: Record<string, unknown>; success?: string; reset?: boolean; idPrefix: string; compact?: boolean;
}) {
  const { busy, error, run } = useRun();
  const [done, setDone] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  return (
    <form
      key={version}
      className={compact ? "inline" : "card"}
      onSubmit={async (e) => {
        e.preventDefault();
        setDone(null);
        const f = new FormData(e.currentTarget);
        const body: Record<string, unknown> = { ...extra };
        for (const fld of fields) {
          const raw = f.get(fld.name);
          if (fld.type === "checkbox") body[fld.name] = raw === "on";
          else if (fld.type === "number") body[fld.name] = raw === null || raw === "" ? undefined : Number(raw);
          else if (typeof raw === "string") body[fld.name] = raw;
        }
        const r = await run(() => api(method, url, body));
        if (r !== undefined) {
          setDone(success ?? "Saved.");
          if (reset) setVersion((v) => v + 1);
        }
      }}
    >
      {fields.map((fld) => {
        const id = `${idPrefix}-${fld.name}`;
        const common = { id, name: fld.name, required: fld.required, "aria-describedby": fld.help ? `${id}-h` : undefined };
        if (fld.type === "checkbox") {
          return (
            <label key={fld.name} className="check" htmlFor={id}>
              <input type="checkbox" {...common} defaultChecked={fld.defaultValue === true} />
              <span>{fld.label}{fld.help && <span className="help" id={`${id}-h`}>{fld.help}</span>}</span>
            </label>
          );
        }
        return (
          <div key={fld.name}>
            <label htmlFor={id} style={compact ? undefined : { marginTop: "0.6rem" }}>{fld.label}{fld.help && <span className="help" id={`${id}-h`}>{fld.help}</span>}</label>
            {fld.type === "textarea" ? (
              <textarea {...common} defaultValue={String(fld.defaultValue ?? "")} maxLength={fld.maxLength} placeholder={fld.placeholder} style={{ minHeight: "4.5rem" }} />
            ) : fld.type === "select" ? (
              <select {...common} defaultValue={String(fld.defaultValue ?? fld.options?.[0]?.[0] ?? "")}>
                {fld.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <input {...common} type={fld.type ?? "text"} defaultValue={fld.defaultValue === undefined ? undefined : String(fld.defaultValue)} min={fld.min} max={fld.max} maxLength={fld.maxLength} placeholder={fld.placeholder} autoComplete="off" />
            )}
          </div>
        );
      })}
      <Err text={error} />
      {done && <p role="status" className="small">{done}</p>}
      <p style={compact ? { margin: 0 } : undefined}><button className="btn" disabled={busy}>{busy ? "Saving…" : submit}</button></p>
    </form>
  );
}
