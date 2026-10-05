import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { listMemberships } from "@/lib/services/access";
import { availableSlots, myAssignments } from "@/lib/services/pickups";
import { safetyAcknowledgedAt } from "@/lib/services/safety";
import { myDeliveries } from "@/lib/services/deliveries";
import { myShifts, openShifts } from "@/lib/services/shifts";
import { DeliveryCard, SafetyGate, ShiftsSection, SlotCard, VolunteerCard } from "@/components/VolunteerView";
import { formatLocal } from "@/lib/time";

export const metadata = { title: "My pickups" };

export default async function VolunteerPage() {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in?next=/volunteer");
  const memberships = listMemberships(actor.id);
  if (memberships.length === 0) {
    return (
      <div style={{ maxWidth: "40rem" }}>
        <h1>My shifts and pickups</h1>
        <p>You are not a volunteer yet. A coordinator in your chapter can add you using the email address you signed in with. Read the <Link href="/safety">Safety rules</Link> while you wait.</p>
      </div>
    );
  }
  const ack = safetyAcknowledgedAt(actor.id);
  const mine = myAssignments(actor);
  const upcoming = mine.filter((p) => p.status === "claimed" || p.status === "scheduled");
  const recent = mine.filter((p) => !upcoming.includes(p));
  const slots = ack ? availableSlots(actor) : [];
  const deliveries = myDeliveries(actor);
  return (
    <div style={{ maxWidth: "40rem" }}>
      <h1>My shifts and pickups</h1>
      <p className="muted small">{memberships.map((m) => `${m.name} (${m.role})`).join(" · ")}</p>
      {ack ? <p className="small muted">Safety rules acknowledged {formatLocal(ack, "America/Toronto")}; <Link href="/safety">read them again</Link>.</p> : <SafetyGate />}

      {ack && <ShiftsSection mine={myShifts(actor)} open={openShifts(actor)} />}

      {deliveries.length > 0 && (
        <>
          <h2>My delivery runs</h2>
          {deliveries.map((d) => <DeliveryCard key={d.id} d={d} />)}
        </>
      )}

      <h2>My pickups</h2>
      {upcoming.length === 0 ? <p className="empty">No pickups assigned to you right now.</p> : upcoming.map((p) => <VolunteerCard key={p.pickupId} p={p} />)}

      {ack && (
        <>
          <h2>Open pickups that need volunteers</h2>
          <p className="muted small">Confirmed pickups that still need volunteers. Every pickup needs two people.</p>
          {slots.length === 0 ? <p className="empty">No open slots right now.</p> : slots.map((s) => <SlotCard key={s.pickupId} s={s} />)}
        </>
      )}

      {recent.length > 0 && (
        <>
          <h2>Last 7 days</h2>
          {recent.map((p) => <VolunteerCard key={p.pickupId} p={p} />)}
        </>
      )}
    </div>
  );
}
