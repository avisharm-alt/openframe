import Link from "next/link";
import { currentActor } from "@/lib/session";
import { listMemberships } from "@/lib/services/access";
import { safetyAcknowledgedAt } from "@/lib/services/safety";
import { DONOR_SAFETY, INSURANCE_NOTICE, PARTNER_NOTICE, SAFETY_RULES } from "@/lib/copy";
import { config } from "@/lib/config";
import { SafetyAck } from "@/components/SafetyAck";

export const metadata = { title: "Safety" };

export default async function Safety() {
  const actor = await currentActor();
  const volunteer = actor ? listMemberships(actor.id).length > 0 : false;
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>Safety</h1>
      <p>
        Pickups mean strangers meet at someone’s door, so safety is built in rather than optional: pairs, daytime, doorstep handoff and private addresses. In an emergency, <b>call 911 first</b>.
      </p>

      <h2>Rules for volunteers</h2>
      <ol>
        {SAFETY_RULES.map((r) => (
          <li key={r.title}><b>{r.title}.</b> {r.body}</li>
        ))}
      </ol>
      {actor && volunteer ? <SafetyAck at={safetyAcknowledgedAt(actor.id)} /> : (
        <p className="small muted">Volunteers acknowledge these rules in <Link href="/volunteer">My pickups</Link> before their first assignment.</p>
      )}

      <h2>What donors can expect</h2>
      <ul>{DONOR_SAFETY.map((x) => <li key={x}>{x}</li>)}</ul>

      <h2>How the safeguards work</h2>
      <ul>
        <li><b>Two-person rule.</b> A pickup cannot be scheduled until two volunteers are assigned, and neither can check in unless both are.</li>
        <li><b>Daytime windows.</b> Pickup windows are accepted only between 9:00 a.m. and 8:00 p.m. in the chapter’s local time.</li>
        <li><b>Check-in and check-out.</b> Each volunteer taps “Arrived” and then “Done” or “Couldn’t complete” with a reason. If a pickup is not closed within {config.pickupOverdueHours} hours of its window ending, coordinators are alerted.</li>
        <li><b>Private addresses.</b> Addresses, access notes and phone numbers are encrypted. They are shown only to the donor, the chapter’s coordinators and the assigned volunteers, from {config.pickupVisibleHoursBefore} hours before the window until the pickup is closed. Every view is recorded in an audit log. They are erased {config.pickupPurgeDays} days after the pickup is collected, cancelled or a no-show.</li>
        <li><b>Reports.</b> A donor can report a concern about a volunteer, and a volunteer about a donor. Reports go to the chapter’s coordinators, who handle safety concerns first.</li>
        <li><b>Limits.</b> A donor can have at most 3 open pickup pledges, and pledge creation is rate limited.</li>
      </ul>

      <h2>Reporting a concern</h2>
      <p>
        Donors: open <Link href="/pledges">My pledges</Link> and choose “Report a concern” on the pledge. Volunteers: use “Report a concern about this pickup” in <Link href="/volunteer">My pickups</Link>, or tap “Couldn’t complete” and choose
        “I had a safety concern”. {config.contact ? <>You can also contact the project at <code>{config.contact}</code>.</> : <>The project has not configured a public contact address yet; until it does, tell your chapter coordinator.</>}
      </p>

      <h2>Insurance and partners</h2>
      <p>{INSURANCE_NOTICE}</p>
      <p>{PARTNER_NOTICE}</p>
    </div>
  );
}
