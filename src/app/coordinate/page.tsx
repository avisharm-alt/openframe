import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { listMemberships } from "@/lib/services/access";
import { listChapters } from "@/lib/services/chapters";
import { isAdmin } from "@/lib/types";

export const metadata = { title: "Coordinate" };

export default async function Coordinate() {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in?next=/coordinate");
  const mine = listMemberships(actor.id).filter((m) => m.role === "coordinator").map((m) => ({ slug: m.slug, name: m.name }));
  const chapters = isAdmin(actor) ? listChapters({ includeInactive: true }).map((c) => ({ slug: c.slug, name: c.name })) : mine;
  if (chapters.length === 1) redirect(`/coordinate/${chapters[0].slug}`);
  return (
    <div style={{ maxWidth: "40rem" }}>
      <h1>Coordinate</h1>
      {chapters.length === 0 ? (
        <p>You are not a coordinator of any chapter. An admin can appoint you; see <Link href="/about">About</Link> for how chapters work.</p>
      ) : (
        <ul>{chapters.map((c) => <li key={c.slug}><Link href={`/coordinate/${c.slug}`}>{c.name}</Link></li>)}</ul>
      )}
    </div>
  );
}
