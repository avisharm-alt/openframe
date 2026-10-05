import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getBoardCard } from "@/lib/services/requests";
import { listZones } from "@/lib/services/zones";
import { loadRequest } from "@/lib/services/request-core";
import { getChapter } from "@/lib/services/access";
import { ClaimForm } from "@/components/ClaimForm";
import { RequestCard } from "@/components/RequestCard";
import { addDays, localDate } from "@/lib/time";

export const metadata = { title: "Claim a request" };

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  if (!actor) redirect(`/auth/sign-in?next=${encodeURIComponent(`/claim/${id}`)}`);
  const card = getBoardCard(id);
  if (!card) {
    let exists = true;
    try { loadRequest(id); } catch { exists = false; }
    if (!exists) notFound();
    return (
      <div style={{ maxWidth: "40rem" }}>
        <h1>Claim a request</h1>
        <p className="notice" role="status">This request is no longer open: it may be fully claimed already. <Link href="/">See what else is needed</Link>.</p>
      </div>
    );
  }
  if (!card.claimable) return (<div style={{ maxWidth: "40rem" }}><h1>Claim a request</h1><p className="notice">The student team fills kit requests from stock. <Link href="/">See what you can claim</Link>.</p></div>);
  const r = loadRequest(id);
  const chapter = getChapter(r.chapter_id);
  const today = localDate(chapter.timezone);
  const maxDate = r.needed_by < addDays(today, 60) ? r.needed_by : addDays(today, 60);
  return (
    <div style={{ maxWidth: "46rem" }}>
      <h1>Claim a request</h1>
      <p className="muted">Signed in as {actor.name}. <Link href={`/?chapter=${chapter.slug}`}>Back to the board</Link></p>
      <ul className="need-list"><RequestCard c={card} /></ul>
      <ClaimForm
        requestId={id} remaining={card.remaining} label={card.label} neededBy={card.neededBy} excluded={card.excluded} partnerName={card.partnerName}
        zones={listZones(chapter.id, { activeOnly: true }).map((z) => ({ id: z.id, name: z.name, description: z.description, hours: z.hours }))} today={today} maxDate={maxDate}
      />
    </div>
  );
}
