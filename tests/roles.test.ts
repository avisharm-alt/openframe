import { beforeEach, describe, expect, it } from "vitest";
import { world, NEEDED_BY, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { isCoordinatorOf, isVolunteerOf, isAgencyWorkerOf } from "@/lib/services/access";
import { createChapter, listMembers, removeMember, setMember } from "@/lib/services/chapters";
import { createPartner, createSite, decidePartner, decideWorker, listApprovals, listWorkers, requestAccess, updatePartner, updateSite, applyPartner } from "@/lib/services/partners";
import { createZone, updateZone } from "@/lib/services/zones";
import { createItem } from "@/lib/services/items";
import { adjustStock, listLedger, listStock } from "@/lib/services/stock";
import { setTarget } from "@/lib/services/restock";
import { assembleKits, createKitTemplate, listAssemblable, updateKitTemplate } from "@/lib/services/kits";
import { cancelRequest, createRequest, fillFromStock, listRequests, listPartnerRequests } from "@/lib/services/requests";
import { createDelivery, listDeliveries, listDeliverables } from "@/lib/services/deliveries";
import { createSlot, listCoverage } from "@/lib/services/shifts";
import { listAudit } from "@/lib/services/audit";

let w: World;
beforeEach(() => {
  w = world();
});
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ServiceError ? e.status : 500;
  }
  return 200;
};
const forbidden = (fn: () => unknown, msg?: string) => expect([403, 404], msg).toContain(status(fn));

describe("chapter and partner roles", () => {
  it("answers who coordinates, volunteers or works for a partner, and where", () => {
    expect(isCoordinatorOf(w.lonCoord, w.london.id)).toBe(true);
    expect(isCoordinatorOf(w.lonCoord, w.oshawa.id)).toBe(false);
    expect(isCoordinatorOf(w.admin, w.oshawa.id)).toBe(true);
    expect(isVolunteerOf(w.vol1, w.london.id)).toBe(true);
    expect(isVolunteerOf(w.vol1, w.oshawa.id)).toBe(false);
    expect(isAgencyWorkerOf(w.worker, w.ark.id)).toBe(true);
    expect(isAgencyWorkerOf(w.worker, w.other.id)).toBe(false); // scoped per partner
    expect(isAgencyWorkerOf(w.pending, w.ark.id)).toBe(false); // not approved yet
    expect(isAgencyWorkerOf(w.neighbour, w.ark.id)).toBe(false);
    expect(isAgencyWorkerOf(w.lonCoord, w.ark.id)).toBe(false);
  });
});

describe("a London coordinator cannot act on Oshawa", () => {
  it("every coordinator action across the model is refused", () => {
    const kit = createKitTemplate(w.oshCoord, w.oshawa.id, { name: "Osh kit", items: [{ itemId: w.item("socks"), quantity: 1 }] });
    const zone = createZone(w.oshCoord, w.oshawa.id, { name: "Z", description: "Front desk" });
    const req = createRequest(w.oshWorker, { type: "item", partnerId: w.oshPartner.id, siteId: w.oshSite.id, itemId: w.item("socks"), size: "", quantity: 3, neededBy: NEEDED_BY }).id;
    const calls: [string, () => unknown][] = [
      ["triage list", () => listRequests(w.lonCoord, w.oshawa.id)],
      ["fill from stock", () => fillFromStock(w.lonCoord, req)],
      ["cancel a request they do not own", () => cancelRequest(w.lonCoord, req)],
      ["stock", () => listStock(w.lonCoord, w.oshawa.id)],
      ["ledger", () => listLedger(w.lonCoord, w.oshawa.id)],
      ["adjust stock", () => adjustStock(w.lonCoord, w.oshawa.id, { kind: "adjusted", itemId: w.item("socks"), size: "", delta: 1, note: "x" })],
      ["restock target", () => setTarget(w.lonCoord, w.oshawa.id, { itemId: w.item("socks"), size: "", target: 5 })],
      ["assemblable kits", () => listAssemblable(w.lonCoord, w.oshawa.id)],
      ["assemble kits", () => assembleKits(w.lonCoord, w.oshawa.id, { templateId: kit.id, count: 1 })],
      ["update kit template", () => updateKitTemplate(w.lonCoord, kit.id, { active: false })],
      ["deliverables", () => listDeliverables(w.lonCoord, w.oshawa.id)],
      ["deliveries", () => listDeliveries(w.lonCoord, w.oshawa.id)],
      ["create delivery", () => createDelivery(w.lonCoord, w.oshawa.id, { siteId: w.oshSite.id, requestIds: [req], plannedFor: "2026-11-05" })],
      ["approvals", () => listApprovals(w.lonCoord, w.oshawa.id)],
      ["partner workers", () => listWorkers(w.lonCoord, w.oshPartner.id)],
      ["approve a worker", () => decideWorker(w.lonCoord, w.oshPartner.id, w.oshWorker.id, { decision: "approved" })],
      ["suspend a partner", () => decidePartner(w.lonCoord, w.oshPartner.id, { decision: "suspended" })],
      ["update a partner", () => updatePartner(w.lonCoord, w.oshPartner.id, { name: "Hijacked" })],
      ["create a partner", () => createPartner(w.lonCoord, w.oshawa.id, { name: "Fake" })],
      ["create a site", () => createSite(w.lonCoord, w.oshPartner.id, { name: "S", address: "1 St" })],
      ["update a site", () => updateSite(w.lonCoord, w.oshSite.id, { name: "S2" })],
      ["create a zone", () => createZone(w.lonCoord, w.oshawa.id, { name: "Z2", description: "x" })],
      ["update a zone", () => updateZone(w.lonCoord, zone.id, { active: false })],
      ["list members", () => listMembers(w.lonCoord, w.oshawa.id)],
      ["add a volunteer", () => setMember(w.lonCoord, w.oshawa.id, { email: "vol.one@example.test", role: "volunteer" })],
      ["remove a member", () => removeMember(w.lonCoord, w.oshawa.id, w.oshCoord.id)],
      ["shift slot", () => createSlot(w.lonCoord, w.oshawa.id, { label: "x", weekday: 1, start: "10:00", end: "12:00", needed: 2 })],
      ["shift coverage", () => listCoverage(w.lonCoord, w.oshawa.id)],
      ["chapter audit log", () => listAudit(w.lonCoord, { chapterId: w.oshawa.id })],
    ];
    for (const [name, fn] of calls) forbidden(fn, name);
  });

  it("members, volunteers and agency workers have no coordinator powers anywhere", () => {
    for (const who of [w.neighbour, w.vol1, w.worker]) {
      forbidden(() => listRequests(who, w.london.id));
      forbidden(() => listStock(who, w.london.id));
      forbidden(() => listApprovals(who, w.london.id));
      forbidden(() => setMember(who, w.london.id, { email: "stranger@example.test", role: "volunteer" }));
      forbidden(() => createItem(who, { name: "Gift card", category: "other", unit: "each" }));
      forbidden(() => createPartner(who, w.london.id, { name: "Fake" }));
      forbidden(() => decideWorker(who, w.ark.id, w.pending.id, { decision: "approved" }));
    }
  });

  it("only an admin appoints coordinators or creates chapters; coordinators manage volunteers", () => {
    forbidden(() => setMember(w.lonCoord, w.london.id, { email: "stranger@example.test", role: "coordinator" }));
    forbidden(() => createChapter(w.lonCoord, { name: "Toronto (UofT)", city: "Toronto, ON", timezone: "America/Toronto" }));
    setMember(w.admin, w.london.id, { email: "stranger@example.test", role: "coordinator" });
    forbidden(() => setMember(w.lonCoord, w.london.id, { email: "stranger@example.test", role: "volunteer" }));
    forbidden(() => removeMember(w.lonCoord, w.london.id, w.stranger.id));
    removeMember(w.lonCoord, w.london.id, w.vol3.id);
    expect(isVolunteerOf(w.vol3, w.london.id)).toBe(false);
    expect(createChapter(w.admin, { name: "Toronto (UofT)", city: "Toronto, ON", timezone: "America/Toronto" }).slug).toBe("toronto");
  });
});

describe("partner approvals", () => {
  it("a worker asks for access and only a coordinator of that chapter approves; pending workers cannot post", () => {
    expect(listApprovals(w.lonCoord, w.london.id).workers.map((x) => [x.userId, x.partnerName])).toEqual([[w.pending.id, "Ark Aid Street Mission"]]);
    expect(status(() => createRequest(w.pending, { type: "item", partnerId: w.ark.id, siteId: w.arkSite.id, itemId: w.item("socks"), size: "", quantity: 1, neededBy: NEEDED_BY }))).toBe(403);
    forbidden(() => decideWorker(w.oshCoord, w.ark.id, w.pending.id, { decision: "approved" }));
    decideWorker(w.lonCoord, w.ark.id, w.pending.id, { decision: "approved" });
    expect(isAgencyWorkerOf(w.pending, w.ark.id)).toBe(true);
    expect(listApprovals(w.lonCoord, w.london.id).workers).toEqual([]);
  });

  it("a rejected worker loses their request; asking twice is refused; a worker can be removed later", () => {
    decideWorker(w.lonCoord, w.ark.id, w.pending.id, { decision: "rejected" });
    expect(isAgencyWorkerOf(w.pending, w.ark.id)).toBe(false);
    requestAccess(w.pending, w.ark.id);
    expect(status(() => requestAccess(w.pending, w.ark.id))).toBe(409);
    decideWorker(w.lonCoord, w.ark.id, w.worker.id, { decision: "rejected" });
    expect(isAgencyWorkerOf(w.worker, w.ark.id)).toBe(false);
    expect(status(() => decideWorker(w.lonCoord, w.ark.id, w.stranger.id, { decision: "approved" }))).toBe(404);
  });

  it("anyone can apply to be a partner: it is pending (and invisible to neighbours) until a coordinator verifies it, which also verifies the applicant", () => {
    const p = applyPartner(w.neighbour, { chapter: "london", name: "New Street Team", description: "Outreach" });
    expect(p.status).toBe("pending");
    expect(listApprovals(w.lonCoord, w.london.id).partners.map((x) => [x.name, x.applicants])).toEqual([["New Street Team", ["Neighbour"]]]);
    const site = createSite(w.lonCoord, p.id, { name: "Their site", address: "9 Queen St" });
    expect(status(() => createRequest(w.neighbour, { type: "item", partnerId: p.id, siteId: site.id, itemId: w.item("socks"), size: "", quantity: 1, neededBy: NEEDED_BY }))).toBe(403); // not verified
    forbidden(() => decidePartner(w.oshCoord, p.id, { decision: "approved" }));
    forbidden(() => decidePartner(w.neighbour, p.id, { decision: "approved" }));
    decidePartner(w.lonCoord, p.id, { decision: "approved" });
    expect(isAgencyWorkerOf(w.neighbour, p.id)).toBe(true);
    expect(status(() => createRequest(w.neighbour, { type: "item", partnerId: p.id, siteId: site.id, itemId: w.item("socks"), size: "", quantity: 1, neededBy: NEEDED_BY }))).toBe(200);
  });

  it("a suspended partner's workers cannot post, and workers cannot be approved for an unverified partner", () => {
    decidePartner(w.lonCoord, w.ark.id, { decision: "suspended" });
    expect(isAgencyWorkerOf(w.worker, w.ark.id)).toBe(false);
    expect(status(() => createRequest(w.worker, { type: "item", partnerId: w.ark.id, siteId: w.arkSite.id, itemId: w.item("socks"), size: "", quantity: 1, neededBy: NEEDED_BY }))).toBe(403);
    const p = applyPartner(w.stranger, { chapter: "london", name: "Pending Org" });
    expect(status(() => decideWorker(w.lonCoord, p.id, w.vol1.id, { decision: "approved" }))).toBe(404); // vol1 never asked
  });

  it("a worker sees only their own partner's requests", () => {
    forbidden(() => listPartnerRequests(w.worker, w.other.id));
    forbidden(() => listPartnerRequests(w.worker2, w.ark.id));
  });
});
