"use client";
// Guest progress lives only in this browser (localStorage). Failures (private mode, blocked storage) are ignored.
const KEY = "openframe.history.v1";

export type GuestEntry = {
  id: string;
  courseCode: string;
  courseTitle: string;
  mode: string;
  createdAt: string;
  total: number;
  correct?: number;
  finished?: boolean;
};

export function readHistory(): GuestEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(list: GuestEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* ignore */
  }
}
export function addHistory(e: GuestEntry) {
  write([e, ...readHistory().filter((x) => x.id !== e.id)]);
}
export function updateHistory(id: string, patch: Partial<GuestEntry>) {
  write(readHistory().map((x) => (x.id === id ? { ...x, ...patch } : x)));
}
export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
