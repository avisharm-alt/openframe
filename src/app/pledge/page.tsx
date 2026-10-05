import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { listChapters } from "@/lib/services/chapters";
import { listBoard } from "@/lib/services/needs";
import { listZones } from "@/lib/services/zones";
import { PledgeForm } from "@/components/PledgeForm";
import { localDate } from "@/lib/time";

export const metadata = { title: "Pledge items" };

export default async function PledgePage({ searchParams }: { searchParams: Promise<{ chapter?: string }> }) {
  const sp = await searchParams;
  const chapters = listChapters();
  const chapter = chapters.find((c) => c.slug === sp.chapter) ?? (chapters.length === 1 ? chapters[0] : undefined);
  const actor = await currentActor();
  if (!actor) redirect(`/auth/sign-in?next=${encodeURIComponent(`/pledge${chapter ? `?chapter=${chapter.slug}` : ""}`)}`);
  if (!chapter) {
    return (
      <>
        <h1>Pledge items</h1>
        <p>Choose a chapter first.</p>
        <ul>{chapters.map((c) => <li key={c.slug}><Link href={`/pledge?chapter=${c.slug}`}>{c.name}</Link></li>)}</ul>
      </>
    );
  }
  const lines = listBoard(chapter.id).filter((l) => l.remaining > 0);
  return (
    <div style={{ maxWidth: "46rem" }}>
      <h1>Pledge items to {chapter.name}</h1>
      <p className="muted">Signed in as {actor.name}. Not the right chapter? {chapters.filter((c) => c.slug !== chapter.slug).map((c) => <Link key={c.slug} href={`/pledge?chapter=${c.slug}`}>Switch to {c.name}</Link>)}</p>
      <PledgeForm
        chapter={{ slug: chapter.slug, name: chapter.name }}
        lines={lines.map((l) => ({ needId: l.needId, itemName: l.itemName, unit: l.unit, remaining: l.remaining, newOnly: l.newOnly, note: l.note }))}
        zones={listZones(chapter.id, { activeOnly: true }).map((z) => ({ id: z.id, name: z.name, description: z.description, hours: z.hours }))}
        today={localDate(chapter.timezone)}
      />
    </div>
  );
}
