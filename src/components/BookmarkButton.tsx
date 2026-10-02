"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";

export function BookmarkButton({ questionId, initial, signedIn }: { questionId: string; initial: boolean; signedIn: boolean }) {
  const [on, setOn] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  if (!signedIn) return <Link className="small" href="/auth/sign-in">Sign in to bookmark</Link>;
  return (
    <>
      <button
        className="link-btn small"
        aria-pressed={on}
        onClick={async () => {
          setErr(null);
          try {
            await api(on ? "DELETE" : "PUT", `/api/bookmarks/${questionId}`);
            setOn(!on);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {on ? "★ Bookmarked" : "☆ Bookmark"}
      </button>
      {err && <span role="alert" className="field-error">{err}</span>}
    </>
  );
}
