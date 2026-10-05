import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { listMyPledges } from "@/lib/services/pledges";
import { listZones } from "@/lib/services/zones";
import { getChapterBySlug } from "@/lib/services/access";
import { localDate } from "@/lib/time";
import { PledgeCard } from "@/components/MyPledges";

export const metadata = { title: "My pledges" };

export default async function MyPledgesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in?next=/pledges");
  const pledges = listMyPledges(actor);
  const isNew = (await searchParams).new === "1";
  return (
    <div style={{ maxWidth: "46rem" }}>
      <h1>My pledges</h1>
      {isNew && <p className="notice good" role="status">Thank you! Your pledge is in. We emailed you a confirmation (if email is set up on this site).</p>}
      {pledges.length === 0 ? (
        <p className="empty">You have not pledged anything yet. <Link href="/">See what is needed</Link>.</p>
      ) : (
        pledges.map((p) => {
          const ch = getChapterBySlug(p.chapterSlug);
          return <PledgeCard key={p.id} p={p} today={localDate(ch.timezone)} zones={listZones(ch.id, { activeOnly: true }).map((z) => ({ id: z.id, name: z.name, description: z.description, hours: z.hours }))} />;
        })
      )}
    </div>
  );
}
