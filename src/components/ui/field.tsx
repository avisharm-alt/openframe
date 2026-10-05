"use client";
import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icon } from "./icons";

type FieldCtx = { id: string; describedBy?: string; invalid: boolean; required: boolean };
const Ctx = createContext<FieldCtx | null>(null);

/**
 * Label + hint + error around one control. Wires up `for`, `aria-describedby`, `aria-invalid` and `required`
 * automatically, so the Input/Select/Textarea inside needs no ids of its own.
 */
export function Field({ label, hint, error, required, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      <Ctx.Provider value={{ id, describedBy, invalid: !!error, required: !!required }}>{children}</Ctx.Provider>
      {error && (
        <p className="field-error" id={errorId}>
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function useControl() {
  const f = useContext(Ctx);
  return f ? { id: f.id, "aria-describedby": f.describedBy, "aria-invalid": f.invalid || undefined, required: f.required || undefined } : {};
}

export function Input({ type = "text", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} {...useControl()} {...props} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...useControl()} {...props} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...useControl()} {...props} />;
}
