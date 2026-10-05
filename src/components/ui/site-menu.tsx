"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

const noop = () => () => {};

/**
 * Header menu for small screens. Progressive enhancement:
 *  - Without JavaScript the links are rendered open and in the page flow, so navigation always works.
 *  - Once hydrated, below 48rem the links collapse behind a disclosure button (aria-expanded / aria-controls).
 *  - Escape closes the menu and returns focus to the button; following a link closes it.
 */
export function SiteMenu({ children }: { children: ReactNode }) {
  const id = useId();
  const pathname = usePathname();
  const js = useSyncExternalStore(noop, () => true, () => false);
  // Remember WHICH page the menu was opened on: navigating elsewhere closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenOn(null);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="menu-wrap" data-js={js ? "true" : "false"} data-open={open ? "true" : "false"}>
        <button ref={button} type="button" className="menu-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpenOn(open ? null : pathname)}>
          <Icon name={open ? "close" : "menu"} />
          <span>{open ? "Close" : "Menu"}</span>
        </button>
        <div id={id} className="site-menu">
          {children}
        </div>
      </div>
    </>
  );
}
