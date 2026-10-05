import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getChapter, getPartnerRef, listPartnerMemberships } from "@/lib/services/access";
import { listChapters } from "@/lib/services/chapters";
import { listPartners, listSitesFor } from "@/lib/services/partners";
import { listItems } from "@/lib/services/items";
import { listKitTemplates } from "@/lib/services/kits";
import { lastRequest, listFavourites, listPartnerRequests } from "@/lib/services/requests";
import { PartnerAccess, PartnerRequests, QuickRequestForm } from "@/components/PartnerPortal";
import { REQUEST_WARNING } from "@/lib/copy";
import { localDate } from "@/lib/time";

export const metadata = { title: "For partners" };

export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ partner?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in?next=/partner");
  const memberships = listPartnerMemberships(actor.id);
  const approved = memberships.filter((m) => m.status === "approved" && m.partnerStatus === "approved");
  const sp = await searchParams;
  const selected = approved.find((m) => m.partnerId === sp.partner) ?? approved[0];

  if (!selected) {
    const pending = memberships.filter((m) => m.status === "pending" || m.partnerStatus === "pending");
    const chapters = listChapters();
    const partners = chapters.flatMap((c) => listPartners(c.id).map((p) => ({ id: p.id, name: p.name, chapterName: c.name })));
    return (
      <div style={{ maxWidth: "40rem" }}>
        <h1>For partners</h1>
        <p className="muted">Frontline workers at shelters, outreach teams and drop-ins post specific, anonymous requests here, and neighbours claim them. {REQUEST_WARNING}</p>
        {pending.length > 0 && (
          <p className="notice" role="status">Waiting for a coordinator to approve: {pending.map((m) => m.name).join(", ")}. We will not show requests tools until then.</p>
        )}
        <PartnerAccess partners={partners.filter((p) => !memberships.some((m) => m.partnerId === p.id))} chapters={chapters.map((c) => ({ slug: c.slug, name: c.name }))} />
        <p className="small muted">Read <Link href="/guidelines">how to write a good request</Link>.</p>
      </div>
    );
  }

  const ref = getPartnerRef(selected.partnerId);
  const chapter = getChapter(ref.chapterId);
  const sites = listSitesFor(actor, ref.id);
  const requests = listPartnerRequests(actor, ref.id);
  return (
    <div style={{ maxWidth: "40rem" }}>
      <h1>{ref.name}</h1>
      <p className="muted" style={{ marginTop: "-0.4rem" }}>Requests for {chapter.name}. Signed in as {actor.name}.</p>
      {approved.length > 1 && (
        <p className="small">Switch partner: {approved.map((m) => <Link key={m.partnerId} href={`/partner?partner=${m.partnerId}`} style={{ marginRight: "0.8rem" }}>{m.name}</Link>)}</p>
      )}
      <h2>Post a request</h2>
      {sites.length === 0 ? (
        <p className="notice warn" role="status">Your partner has no delivery site yet. Ask your chapter’s coordinator to add one.</p>
      ) : (
        <QuickRequestForm
          partnerId={ref.id} sites={sites.map((s) => ({ id: s.id, name: s.name }))} items={listItems({ activeOnly: true })} kits={listKitTemplates(chapter.id, { activeOnly: true }).map((k) => ({ id: k.id, name: k.name }))}
          last={lastRequest(actor, ref.id)} favourites={listFavourites(actor, ref.id)} today={localDate(chapter.timezone)}
        />
      )}
      <h2>My partner’s requests</h2>
      <PartnerRequests requests={requests} />
    </div>
  );
}
