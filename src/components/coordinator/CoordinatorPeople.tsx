"use client";
import { ScrollTable } from "../ScrollTable";
import { api } from "@/lib/api-client";
import { formatLocal } from "@/lib/time";
import { CONCERN_LABELS, REPORT_STATES } from "@/lib/types";
import type { Member } from "@/lib/services/chapters";
import type { Zone } from "@/lib/services/zones";
import type { Partner } from "@/lib/services/partners";
import type { ConcernRow } from "@/lib/services/concerns";
import type { AuditRow } from "@/lib/services/audit";
import { ActionButton, JsonForm } from "../forms";

export function PeopleTab({ slug, members, isAdmin }: { slug: string; members: Member[]; isAdmin: boolean }) {
  return (
    <>
      <p className="muted">
        Volunteers must acknowledge the <a href="/safety">Safety rules</a> before their first assignment. People need to have signed in once before you can add them. {isAdmin ? "As an admin you can also appoint coordinators." : "Only an admin can appoint coordinators."}
      </p>
      <JsonForm
        idPrefix="member" url={`/api/chapters/${slug}/members`} submit="Add to chapter" success="Added."
        fields={[
          { name: "email", label: "Their sign-in email", type: "email", required: true },
          { name: "role", label: "Role", type: "select", options: isAdmin ? [["volunteer", "Volunteer"], ["coordinator", "Coordinator"]] : [["volunteer", "Volunteer"]] },
        ]}
      />
      <div style={{ marginTop: "1rem" }}>
      <ScrollTable label="Chapter members">
        <table className="compact">
          <caption className="sr-only">Chapter members</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Safety rules</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>{m.name}</td><td>{m.email}</td><td>{m.role}</td>
                <td>{m.safetyAcknowledged ? <span className="badge ok">Acknowledged</span> : <span className="badge">Not yet</span>}</td>
                <td>{(isAdmin || m.role === "volunteer") && <ActionButton label={`Remove ${m.name}`} className="link-btn small" confirm={`Remove ${m.name} from this chapter?`} action={() => api("DELETE", `/api/chapters/${slug}/members/${m.userId}`)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      </div>
    </>
  );
}

export function ZonesTab({ slug, zones }: { slug: string; zones: Zone[] }) {
  return (
    <>
      <p className="muted">Drop-off zones are <b>public</b>. Describe a public place (a campus front desk, a lobby), never a private address.</p>
      {zones.map((z) => (
        <details className="card" key={z.id}>
          <summary>{z.name} <span className={`status ${z.active ? "received" : ""}`}>{z.active ? "Active" : "Inactive"}</span></summary>
          <JsonForm
            idPrefix={`z-${z.id}`} url={`/api/zones/${z.id}`} method="PATCH" submit="Save zone" reset={false}
            fields={[
              { name: "name", label: "Name", defaultValue: z.name, maxLength: 80 },
              { name: "description", label: "Where (public description)", defaultValue: z.description, maxLength: 300 },
              { name: "hours", label: "Hours", defaultValue: z.hours, maxLength: 120 },
              { name: "active", label: "Active", type: "checkbox", defaultValue: z.active },
            ]}
          />
        </details>
      ))}
      <h3>New drop-off zone</h3>
      <JsonForm
        idPrefix="z-new" url={`/api/chapters/${slug}/zones`} submit="Add zone"
        fields={[
          { name: "name", label: "Name", required: true, maxLength: 80, placeholder: "Western UCC front desk" },
          { name: "description", label: "Where (public description)", required: true, maxLength: 300, help: "A public place only." },
          { name: "hours", label: "Hours", maxLength: 120, placeholder: "Mon–Fri 10:00–16:00" },
        ]}
      />
    </>
  );
}

export function PartnersTab({ slug, partners }: { slug: string; partners: Partner[] }) {
  return (
    <>
      <p className="muted">Partner agencies hand packages to the people they serve. We record the agency and the date, never the recipient. {" "}
        <a href="/safety">Partner and insurance wording</a> is on the Safety page.</p>
      {partners.map((p) => (
        <details className="card" key={p.id}>
          <summary>{p.name} <span className={`status ${p.active && p.acceptsPackages ? "received" : ""}`}>{p.active ? (p.acceptsPackages ? "Accepting packages" : "Not accepting") : "Inactive"}</span></summary>
          <JsonForm
            idPrefix={`p-${p.id}`} url={`/api/partners/${p.id}`} method="PATCH" submit="Save partner" reset={false}
            fields={[
              { name: "name", label: "Name", defaultValue: p.name, maxLength: 80 },
              { name: "description", label: "Public description", defaultValue: p.description, maxLength: 300 },
              { name: "acceptsPackages", label: "Accepts packages", type: "checkbox", defaultValue: p.acceptsPackages },
              { name: "active", label: "Active", type: "checkbox", defaultValue: p.active },
            ]}
          />
        </details>
      ))}
      <h3>New partner agency</h3>
      <JsonForm
        idPrefix="p-new" url={`/api/chapters/${slug}/partners`} submit="Add partner"
        fields={[
          { name: "name", label: "Name", required: true, maxLength: 80 },
          { name: "description", label: "Public description", maxLength: 300 },
          { name: "acceptsPackages", label: "Accepts packages", type: "checkbox", defaultValue: true },
        ]}
      />
    </>
  );
}

export function ReportsTab({ reports }: { reports: ConcernRow[] }) {
  if (reports.length === 0) return <p className="empty">No concerns have been reported.</p>;
  return (
    <>
      {reports.map((r) => (
        <article className={`card-sm${r.priority >= 2 && (r.state === "open" || r.state === "investigating") ? " overdue" : ""}`} key={r.id} aria-label={`Concern: ${CONCERN_LABELS[r.category]}`}>
          <h4>
            {CONCERN_LABELS[r.category]} <span className="status">{r.state}</span>{" "}
            <span className="muted small">reported by a {r.reporterRole} · {r.createdAt.slice(0, 16).replace("T", " ")} UTC</span>
          </h4>
          {r.details && <p style={{ margin: "0.2rem 0" }}>{r.details}</p>}
          <p className="small muted" style={{ margin: "0.2rem 0" }}>Donor: {r.donorName ?? "former donor"} · Volunteers: {r.volunteers.length ? r.volunteers.join(", ") : "none"}</p>
          <details>
            <summary className="small">Handle</summary>
            <JsonForm
              idPrefix={`r-${r.id}`} url={`/api/reports/${r.id}`} method="PATCH" submit="Save" reset={false}
              fields={[
                { name: "state", label: "State", type: "select", options: REPORT_STATES.map((s) => [s, s]), defaultValue: r.state },
                { name: "resolutionNote", label: "Resolution note", type: "textarea", maxLength: 1000, defaultValue: r.resolutionNote ?? "" },
              ]}
            />
          </details>
        </article>
      ))}
    </>
  );
}

export function AuditTable({ events, tz }: { events: AuditRow[]; tz: string }) {
  return (
    <ScrollTable label="Audit log">
      <table className="compact">
        <caption className="sr-only">Audit log</caption>
        <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Subject</th><th scope="col">Detail</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{formatLocal(e.at, tz)}</td><td>{e.actorName ?? "system"}</td><td>{e.action}</td>
              <td>{e.subjectType ? `${e.subjectType} ${e.subjectId?.slice(0, 8) ?? ""}` : ""}</td>
              <td className="small">{Object.keys(e.detail).length ? JSON.stringify(e.detail) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
