"use client";
import { ScrollTable } from "../ScrollTable";
import { api } from "@/lib/api-client";
import { formatLocal } from "@/lib/time";
import { CONCERN_LABELS, REPORT_STATES } from "@/lib/types";
import type { Member } from "@/lib/services/chapters";
import type { Zone } from "@/lib/services/zones";
import type { Partner, PendingApprovals, Site } from "@/lib/services/partners";
import type { Occurrence, Period, Slot } from "@/lib/services/shifts";
import type { ConcernRow } from "@/lib/services/concerns";
import type { AuditRow } from "@/lib/services/audit";
import { ActionButton, JsonForm } from "../forms";

export function PeopleTab({ slug, members, isAdmin }: { slug: string; members: Member[]; isAdmin: boolean }) {
  return (
    <>
      <p className="muted">
        Volunteers must acknowledge the <a href="/safety">Safety rules</a> before their first assignment, and always go in pairs. People need to have signed in once before you can add them. {isAdmin ? "As an admin you can also appoint coordinators." : "Only an admin can appoint coordinators."}
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

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type PartnerAdmin = Partner & {
  sites: Site[];
  workers: { userId: string; name: string; email: string; status: string }[];
};

export function ApprovalsPanel({ approvals }: { approvals: PendingApprovals }) {
  const { partners, workers } = approvals;
  if (partners.length === 0 && workers.length === 0) return <p className="empty">Nothing is waiting for verification.</p>;
  return (
    <>
      <p className="muted">
        Verify who is on the other end before anything is posted: call or visit the agency, check the person works there, and keep a one-page partnership note (see <a href="/safety">Safety</a>).
      </p>
      {partners.length > 0 && <h3>Partners to verify</h3>}
      {partners.map((p) => (
        <article className="card-sm" key={p.id} aria-label={`Partner to verify: ${p.name}`}>
          <h4>{p.name}</h4>
          {p.description && <p style={{ margin: "0.2rem 0" }}>{p.description}</p>}
          <p className="small muted" style={{ margin: "0.2rem 0" }}>Applied by: {p.applicants.length ? p.applicants.join(", ") : "unknown"}</p>
          <span className="row">
            <ActionButton label="Verify partner" className="btn small" action={() => api("POST", `/api/partners/${p.id}/decision`, { decision: "approved" })} />
            <ActionButton label="Reject" className="link-btn small" confirm={`Reject ${p.name}?`} action={() => api("POST", `/api/partners/${p.id}/decision`, { decision: "rejected" })} />
          </span>
        </article>
      ))}
      {workers.length > 0 && <h3>Agency workers to approve</h3>}
      {workers.map((w) => (
        <article className="card-sm" key={`${w.partnerId}-${w.userId}`} aria-label={`Worker to approve: ${w.name}`}>
          <h4>{w.name} <span className="muted small">{w.email}</span></h4>
          <p className="small muted" style={{ margin: "0.2rem 0" }}>Asked to post for {w.partnerName}</p>
          <span className="row">
            <ActionButton label={`Approve ${w.name}`} className="btn small" action={() => api("POST", `/api/partners/${w.partnerId}/workers/${w.userId}`, { decision: "approved" })} />
            <ActionButton label={`Decline ${w.name}`} className="link-btn small" action={() => api("POST", `/api/partners/${w.partnerId}/workers/${w.userId}`, { decision: "rejected" })} />
          </span>
        </article>
      ))}
    </>
  );
}

export function PartnersTab({ slug, partners }: { slug: string; partners: PartnerAdmin[] }) {
  return (
    <>
      <p className="muted">
        Partners post requests for items; the people they serve are never recorded here. Each partner has delivery sites (public name, address and receiving hours) and approved workers.
      </p>
      {partners.map((p) => (
        <details className="card" key={p.id}>
          <summary>{p.name} <span className={`status ${p.status === "approved" && p.active ? "received" : ""}`}>{p.status === "approved" ? (p.active ? "Verified" : "Inactive") : p.status}</span></summary>
          <JsonForm
            idPrefix={`p-${p.id}`} url={`/api/partners/${p.id}`} method="PATCH" submit="Save partner" reset={false}
            fields={[
              { name: "name", label: "Name", defaultValue: p.name, maxLength: 80 },
              { name: "description", label: "Public description", defaultValue: p.description, maxLength: 300 },
              { name: "excludedItems", label: "Items they do not accept", defaultValue: p.excludedItems, maxLength: 300, help: "Shown to neighbours before they claim." },
              { name: "active", label: "Active", type: "checkbox", defaultValue: p.active },
            ]}
          />
          <h4>Delivery sites</h4>
          {p.sites.length === 0 && <p className="empty">No delivery sites yet. Requests need one.</p>}
          {p.sites.map((s) => (
            <details key={s.id} className="card-sm">
              <summary>{s.name} <span className="muted small">{s.address}</span> {!s.active && <span className="status">Inactive</span>}</summary>
              <JsonForm
                idPrefix={`s-${s.id}`} url={`/api/sites/${s.id}`} method="PATCH" submit="Save site" reset={false}
                fields={[
                  { name: "name", label: "Name", defaultValue: s.name, maxLength: 80 },
                  { name: "address", label: "Address (public: it is an agency building)", defaultValue: s.address, maxLength: 200 },
                  { name: "receivingHours", label: "Receiving hours", defaultValue: s.receivingHours, maxLength: 120 },
                  { name: "active", label: "Active", type: "checkbox", defaultValue: s.active },
                ]}
              />
            </details>
          ))}
          <JsonForm
            idPrefix={`sn-${p.id}`} url={`/api/partners/${p.id}/sites`} submit="Add delivery site"
            fields={[
              { name: "name", label: "New site name", required: true, maxLength: 80, placeholder: "Ark Aid Street Mission" },
              { name: "address", label: "Address", required: true, maxLength: 200 },
              { name: "receivingHours", label: "Receiving hours", maxLength: 120, placeholder: "Mon–Fri 9:00–16:00" },
            ]}
          />
          <h4>Workers</h4>
          {p.workers.length === 0 ? <p className="empty">No workers yet.</p> : (
            <ul className="plain">
              {p.workers.map((w) => (
                <li key={w.userId}>
                  {w.name} <span className="muted small">{w.email}</span> <span className="status">{w.status}</span>{" "}
                  <ActionButton
                    label={`Remove ${w.name}`} className="link-btn small" confirm={`Remove ${w.name} from ${p.name}?`}
                    action={() => api("POST", `/api/partners/${p.id}/workers/${w.userId}`, { decision: "rejected" })}
                  />
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
      <h3>New partner</h3>
      <JsonForm
        idPrefix="p-new" url={`/api/chapters/${slug}/partners`} submit="Add verified partner"
        fields={[
          { name: "name", label: "Name", required: true, maxLength: 80 },
          { name: "description", label: "Public description", maxLength: 300 },
          { name: "excludedItems", label: "Items they do not accept", maxLength: 300 },
        ]}
      />
    </>
  );
}

export function ShiftsTab({ slug, slots, coverage, periods }: { slug: string; slots: Slot[]; coverage: Occurrence[]; periods: Period[] }) {
  const gaps = coverage.filter((o) => o.gap > 0);
  return (
    <>
      <p className="muted">
        Weekly shift slots repeat every week. Volunteers sign up for dates; pickups and deliveries are suggested to people on the matching shift. Raise the number needed for exam periods and holidays below.
      </p>
      <h3>Coverage, next 4 weeks {gaps.length > 0 && <span className="badge">{gaps.length} gap{gaps.length === 1 ? "" : "s"}</span>}</h3>
      {coverage.length === 0 ? <p className="empty">No shift slots yet.</p> : (
        <ScrollTable label="Shift coverage">
          <table className="compact">
            <caption className="sr-only">Shift coverage by date</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Shift</th><th scope="col">Signed up</th><th scope="col">Needed</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {coverage.map((o) => (
                <tr key={`${o.slotId}-${o.date}`} className={o.gap > 0 ? "overdue" : undefined}>
                  <td>{o.date}</td>
                  <td>{o.label} {o.start}–{o.end}{o.periodLabel && <span className="muted small"> ({o.periodLabel})</span>}</td>
                  <td>{o.signedUp.length ? o.signedUp.map((v) => v.name).join(", ") : "nobody"}</td>
                  <td>{o.needed + o.boost}</td>
                  <td>{o.gap > 0 ? <span className="badge">Needs {o.gap} more</span> : <span className="badge ok">Covered</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
      <h3>Weekly slots</h3>
      {slots.map((s) => (
        <details className="card" key={s.id}>
          <summary>{s.label} <span className="muted small">{WEEKDAYS[s.weekday]} {s.start}–{s.end}, {s.needed} needed</span> {!s.active && <span className="status">Inactive</span>}</summary>
          <JsonForm
            idPrefix={`sl-${s.id}`} url={`/api/shifts/${s.id}`} method="PATCH" submit="Save slot" reset={false}
            fields={[
              { name: "label", label: "Label", defaultValue: s.label, maxLength: 60 },
              { name: "needed", label: "Volunteers needed", type: "number", defaultValue: s.needed, min: 1, max: 10 },
              { name: "active", label: "Active", type: "checkbox", defaultValue: s.active },
            ]}
          />
        </details>
      ))}
      <JsonForm
        idPrefix="sl-new" url={`/api/chapters/${slug}/shifts`} submit="Add weekly slot"
        fields={[
          { name: "label", label: "Label", required: true, maxLength: 60, placeholder: "Tuesday evening run" },
          { name: "weekday", label: "Day", type: "select", numeric: true, options: WEEKDAYS.map((d, i) => [String(i), d]) },
          { name: "start", label: "Start (24 h)", required: true, placeholder: "17:00" },
          { name: "end", label: "End (24 h)", required: true, placeholder: "19:00" },
          { name: "needed", label: "Volunteers needed", type: "number", defaultValue: 2, min: 1, max: 10 },
        ]}
      />
      <h3>Exam periods and holidays</h3>
      {periods.length === 0 ? <p className="empty">None planned. Add one to ask for more volunteers on every slot in a date range.</p> : (
        <ul className="plain">
          {periods.map((p) => (
            <li key={p.id}>
              {p.label}: {p.startDate} to {p.endDate}, +{p.extraNeeded} per slot{" "}
              <ActionButton label={`Remove ${p.label}`} className="link-btn small" confirm={`Remove ${p.label}?`} action={() => api("DELETE", `/api/shift-periods/${p.id}`)} />
            </li>
          ))}
        </ul>
      )}
      <JsonForm
        idPrefix="per-new" url={`/api/chapters/${slug}/shift-periods`} submit="Add period"
        fields={[
          { name: "label", label: "Label", required: true, maxLength: 60, placeholder: "Winter exams" },
          { name: "startDate", label: "From", type: "date", required: true },
          { name: "endDate", label: "To", type: "date", required: true },
          { name: "extraNeeded", label: "Extra volunteers per slot", type: "number", defaultValue: 1, min: 0, max: 10 },
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
          <p className="small muted" style={{ margin: "0.2rem 0" }}>Neighbour: {r.neighbourName ?? "none / former neighbour"} · Volunteers: {r.volunteers.length ? r.volunteers.join(", ") : "none"}</p>
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
