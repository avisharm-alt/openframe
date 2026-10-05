"use client";
import { useState } from "react";
import { JsonForm } from "./forms";

/** Pick a chapter, then add a coordinator by email. The request goes to that chapter's members endpoint. */
export function AppointCoordinator({ chapters }: { chapters: { slug: string; name: string }[] }) {
  const [slug, setSlug] = useState(chapters[0].slug);
  return (
    <>
      <label htmlFor="ac-chapter">Chapter</label>
      <select id="ac-chapter" value={slug} onChange={(e) => setSlug(e.target.value)}>
        {chapters.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </select>
      <JsonForm
        key={slug} idPrefix="ac" url={`/api/chapters/${slug}/members`} submit="Appoint coordinator" extra={{ role: "coordinator" }} success="Appointed."
        fields={[{ name: "email", label: "Their sign-in email", type: "email", required: true }]}
      />
    </>
  );
}
