import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getChapterBySlug, isCoordinatorOf } from "@/lib/services/access";
import { isAdmin } from "@/lib/types";
import { listItems } from "@/lib/services/items";
import { listRequests } from "@/lib/services/requests";
import { listAwaitingReceipt, listIncomingDropoffs } from "@/lib/services/claims";
import { pickupBoard } from "@/lib/services/pickups";
import { listLedger, listStock } from "@/lib/services/stock";
import { listAssemblable, listKitTemplates } from "@/lib/services/kits";
import { listDeliverables, listDeliveries } from "@/lib/services/deliveries";
import { listMembers } from "@/lib/services/chapters";
import { listZones } from "@/lib/services/zones";
import { listApprovals, listPartnersAdmin } from "@/lib/services/partners";
import { listCoverage, listPeriods, listSlots } from "@/lib/services/shifts";
import { listConcerns } from "@/lib/services/concerns";
import { listAudit } from "@/lib/services/audit";
import { localDate } from "@/lib/time";
import { RequestsTriage } from "@/components/coordinator/CoordinatorRequests";
import { DropoffsTable, PickupBoardView, ReceiveTab } from "@/components/coordinator/CoordinatorOps";
import { Deliverables, DeliveryList } from "@/components/coordinator/CoordinatorDeliveries";
import { KitsTab, StockTab } from "@/components/coordinator/CoordinatorStock";
import { ApprovalsPanel, AuditTable, PartnersTab, PeopleTab, ReportsTab, ShiftsTab, ZonesTab } from "@/components/coordinator/CoordinatorPeople";

export const metadata = { title: "Coordinate" };

const TABS: [string, string][] = [
  ["requests", "Requests"], ["pickups", "Pickups"], ["dropoffs", "Drop-offs"], ["receive", "Receive"], ["deliveries", "Deliveries"],
  ["stock", "Stock"], ["kits", "Kits"], ["approvals", "Approvals"], ["partners", "Partners"], ["people", "Volunteers"],
  ["shifts", "Shifts"], ["zones", "Zones"], ["reports", "Concerns"], ["audit", "Audit log"],
];

export default async function Dashboard({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect(`/auth/sign-in?next=/coordinate/${slug}`);
  const chapter = getChapterBySlug(slug);
  if (!isCoordinatorOf(actor, chapter.id)) notFound();
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "requests";
  const items = listItems({ activeOnly: true });
  const today = localDate(chapter.timezone);

  let body: React.ReactNode;
  switch (tab) {
    case "requests":
      body = (<><p className="muted">Open requests, most urgent first. Requests at risk of missing their needed-by date are highlighted. Where the shelf has enough, <b>Fill from stock</b> sends it straight to delivery.</p><RequestsTriage rows={listRequests(actor, chapter.id)} /></>);
      break;
    case "pickups": body = <PickupBoardView board={pickupBoard(actor, chapter.id)} roster={listMembers(actor, chapter.id)} tz={chapter.timezone} />; break;
    case "dropoffs": body = (<><p className="muted">Incoming drop-offs by date and zone. Count items into stock or against a request on the <Link href={`/coordinate/${slug}?tab=receive`}>Receive</Link> tab.</p><DropoffsTable rows={listIncomingDropoffs(actor, chapter.id)} /></>); break;
    case "receive": body = <ReceiveTab claims={listAwaitingReceipt(actor, chapter.id)} items={items} />; break;
    case "deliveries":
      body = (
        <>
          <h3 style={{ marginTop: 0 }}>Ready to deliver</h3>
          <Deliverables slug={slug} rows={listDeliverables(actor, chapter.id)} today={today} />
          <h3>Delivery runs</h3>
          <DeliveryList deliveries={listDeliveries(actor, chapter.id)} roster={listMembers(actor, chapter.id)} />
        </>
      );
      break;
    case "stock": body = <StockTab slug={slug} stock={listStock(actor, chapter.id)} ledger={listLedger(actor, chapter.id, 30)} items={items} />; break;
    case "kits": body = <KitsTab slug={slug} assemblable={listAssemblable(actor, chapter.id)} templates={listKitTemplates(chapter.id)} items={items} />; break;
    case "approvals": body = <ApprovalsPanel approvals={listApprovals(actor, chapter.id)} />; break;
    case "partners": body = <PartnersTab slug={slug} partners={listPartnersAdmin(actor, chapter.id)} />; break;
    case "people": body = <PeopleTab slug={slug} members={listMembers(actor, chapter.id)} isAdmin={isAdmin(actor)} />; break;
    case "shifts": body = <ShiftsTab slug={slug} slots={listSlots(chapter.id)} coverage={listCoverage(actor, chapter.id, 4)} periods={listPeriods(chapter.id)} />; break;
    case "zones": body = <ZonesTab slug={slug} zones={listZones(chapter.id)} />; break;
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
