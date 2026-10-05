import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getChapterBySlug, isCoordinatorOf } from "@/lib/services/access";
import { isAdmin } from "@/lib/types";
import { listItems } from "@/lib/services/items";
import { listNeeds } from "@/lib/services/needs";
import { listTemplates } from "@/lib/services/templates";
import { listAwaitingReceipt, listIncomingDropoffs } from "@/lib/services/pledges";
import { pickupBoard } from "@/lib/services/pickups";
import { listInventory, listLedger } from "@/lib/services/inventory";
import { listAssemblable, listPackages } from "@/lib/services/packages";
import { listMembers } from "@/lib/services/chapters";
import { listZones } from "@/lib/services/zones";
import { listPartners } from "@/lib/services/partners";
import { listConcerns } from "@/lib/services/concerns";
import { listAudit } from "@/lib/services/audit";
import { localDate } from "@/lib/time";
import { NeedsEditor, TemplatesTab } from "@/components/coordinator/CoordinatorNeeds";
import { DropoffsTable, PickupBoardView, ReceiveTab } from "@/components/coordinator/CoordinatorOps";
import { InventoryTab, PackagesTab } from "@/components/coordinator/CoordinatorStock";
import { AuditTable, PartnersTab, PeopleTab, ReportsTab, ZonesTab } from "@/components/coordinator/CoordinatorPeople";

export const metadata = { title: "Coordinate" };

const TABS: [string, string][] = [
  ["needs", "Needs"], ["templates", "Templates"], ["dropoffs", "Drop-offs"], ["pickups", "Pickups"], ["receive", "Receive"],
  ["inventory", "Inventory"], ["packages", "Packages"], ["people", "Volunteers"], ["zones", "Zones"], ["partners", "Partners"], ["reports", "Concerns"], ["audit", "Audit log"],
];

export default async function Dashboard({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect(`/auth/sign-in?next=/coordinate/${slug}`);
  const chapter = getChapterBySlug(slug);
  if (!isCoordinatorOf(actor, chapter.id)) notFound();
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "needs";
  const items = listItems({ activeOnly: true });

  let body: React.ReactNode;
  switch (tab) {
    case "needs": body = <NeedsEditor slug={slug} needs={listNeeds(actor, chapter.id)} items={items} />; break;
    case "templates": body = <TemplatesTab slug={slug} templates={listTemplates(chapter.id)} items={items} />; break;
    case "dropoffs": body = (<><p className="muted">Incoming drop-offs by date and zone. Count items into stock on the <Link href={`/coordinate/${slug}?tab=receive`}>Receive</Link> tab.</p><DropoffsTable rows={listIncomingDropoffs(actor, chapter.id)} /></>); break;
    case "pickups": body = <PickupBoardView board={pickupBoard(actor, chapter.id)} roster={listMembers(actor, chapter.id)} tz={chapter.timezone} />; break;
    case "receive": body = <ReceiveTab pledges={listAwaitingReceipt(actor, chapter.id)} items={items} />; break;
    case "inventory": body = <InventoryTab slug={slug} inventory={listInventory(actor, chapter.id)} ledger={listLedger(actor, chapter.id, 30)} />; break;
    case "packages":
      body = (
        <PackagesTab
          slug={slug} assemblable={listAssemblable(actor, chapter.id)} assembled={listPackages(actor, chapter.id, "assembled")} handedOff={listPackages(actor, chapter.id, "handed_off")}
          partners={listPartners(chapter.id)} today={localDate(chapter.timezone)}
        />
      );
      break;
    case "people": body = <PeopleTab slug={slug} members={listMembers(actor, chapter.id)} isAdmin={isAdmin(actor)} />; break;
    case "zones": body = <ZonesTab slug={slug} zones={listZones(chapter.id)} />; break;
    case "partners": body = <PartnersTab slug={slug} partners={listPartners(chapter.id)} />; break;
    case "reports": body = <ReportsTab reports={listConcerns(actor, chapter.id)} />; break;
    default: body = (<><p className="muted">Who did what in {chapter.name}, including every view of a pickup address. Details never contain the address itself.</p><AuditTable events={listAudit(actor, { chapterId: chapter.id, limit: 150 })} tz={chapter.timezone} /></>);
  }
  return (
    <>
      <h1>{chapter.name}</h1>
      <p className="muted" style={{ marginTop: "-0.4rem" }}>Coordinator dashboard · {chapter.city} · times shown in {chapter.timezone}</p>
      <nav className="tabs" aria-label="Dashboard sections">
        {TABS.map(([k, label]) => <Link key={k} href={`/coordinate/${slug}?tab=${k}`} aria-current={k === tab ? "page" : undefined}>{label}</Link>)}
      </nav>
      <section aria-labelledby="tab-h">
        <h2 id="tab-h" style={{ marginTop: 0 }}>{TABS.find(([k]) => k === tab)![1]}</h2>
        {body}
      </section>
    </>
  );
}
