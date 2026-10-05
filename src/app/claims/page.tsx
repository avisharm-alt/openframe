import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { listMyClaims } from "@/lib/services/claims";
import { listZones } from "@/lib/services/zones";
import { getChapterBySlug } from "@/lib/services/access";
import { localDate } from "@/lib/time";
import { ClaimCard } from "@/components/MyClaims";

export const metadata = { title: "My claims" };

export default async function MyClaimsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in?next=/claims");
  const claims = listMyClaims(actor);
  const isNew = (await searchParams).new === "1";
  const delivered = claims.filter((c) => c.delivered).length;
  return (
    <div style={{ maxWidth: "46rem" }}>
      <h1>My claims</h1>
      {isNew && <p className="notice good" role="status">Thank you! Your claim is in. We emailed you a confirmation (if email is set up on this site).</p>}
      {delivered > 0 && <p className="notice good" role="status">{delivered} of your {delivered === 1 ? "claim has" : "claims have"} reached a partner agency. Thank you.</p>}
      {claims.length === 0 ? (
        <p className="empty">You have not claimed anything yet. <Link href="/">See what is needed</Link>.</p>
      ) : (
        claims.map((p) => {
          const ch = getChapterBySlug(p.chapterSlug);
          return <ClaimCard key={p.id} p={p} today={localDate(ch.timezone)} zones={listZones(ch.id, { activeOnly: true }).map((z) => ({ id: z.id, name: z.name, description: z.description, hours: z.hours }))} />;
        })
      )}
    </div>
  );
}
