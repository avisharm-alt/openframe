import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { isAdmin } from "@/lib/types";
import { listChapters } from "@/lib/services/chapters";
import { listAudit } from "@/lib/services/audit";
import { JsonForm } from "@/components/forms";
import { AuditTable } from "@/components/coordinator/CoordinatorPeople";
import { AppointCoordinator } from "@/components/AppointCoordinator";

export const metadata = { title: "Admin" };

export default async function Admin() {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in?next=/admin");
  if (!isAdmin(actor)) {
    return (<><h1>Admin</h1><p>This page is for OpenFrame admins.</p></>);
  }
  const chapters = listChapters({ includeInactive: true });
  return (
    <>
      <h1>Admin</h1>
      <section aria-labelledby="ch-h">
        <h2 id="ch-h">Chapters</h2>
        <ul>{chapters.map((c) => <li key={c.slug}><a href={`/coordinate/${c.slug}`}>{c.name}</a> · {c.city} · {c.timezone}{c.active ? "" : " · inactive"}</li>)}</ul>
        <h3>Start a chapter</h3>
        <p className="muted small">Chapters are data: adding one needs no code change. Then appoint its first coordinator below. See docs/START-A-CHAPTER.md.</p>
        <JsonForm
          idPrefix="chapter" url="/api/chapters" submit="Create chapter" success="Chapter created."
          fields={[
            { name: "name", label: "Chapter name", required: true, maxLength: 80, placeholder: "Toronto (UofT)" },
            { name: "city", label: "City", required: true, maxLength: 80, placeholder: "Toronto, ON" },
            { name: "timezone", label: "Timezone (IANA)", required: true, defaultValue: "America/Toronto", help: "Pickup windows are judged in this timezone." },
            { name: "slug", label: "Web address (optional)", help: "Lowercase letters, numbers, hyphens. Defaults to the city." },
          ]}
        />
      </section>
      <section aria-labelledby="co-h" className="section">
        <h2 id="co-h" style={{ marginTop: 0 }}>Appoint a coordinator</h2>
        <p className="muted small">They must have signed in once. A coordinator can then add volunteers themselves.</p>
        {chapters.length > 0 && <AppointCoordinator chapters={chapters.map((c) => ({ slug: c.slug, name: c.name }))} />}
      </section>
      <section aria-labelledby="au-h" className="section">
        <h2 id="au-h" style={{ marginTop: 0 }}>Audit log (latest 100)</h2>
        <AuditTable events={listAudit(actor, { limit: 100 })} tz="America/Toronto" />
      </section>
    </>
  );
}
