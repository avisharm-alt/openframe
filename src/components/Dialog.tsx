"use client";
import { useEffect, useRef } from "react";

/** Accessible modal built on the native <dialog> element (focus trap, Esc to close). */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title">
      <h2 id="dlg-title" style={{ marginTop: 0 }}>{title}</h2>
      {open && children}
    </dialog>
  );
}
