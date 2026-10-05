// End-to-end walkthrough against a RUNNING server (real HTTP, real auth, real SQLite):
//
//   agency worker posts a request -> neighbour claims it with a pickup -> coordinator assigns two volunteers -> a
//   volunteer sees the address only inside the allowed window -> collected -> received -> delivered to the agency ->
//   the worker confirms -> the neighbour sees "Delivered to [partner]" -> impact shows time to delivery -> address purged
//
// plus a second request filled straight from stock, claim auto-release, restock requests, and negative checks
// (cross-chapter and cross-partner access, address leakage through every API and page, at-rest plaintext, role
// escalation, cross-origin writes, uploads, daytime-window and pickup-limit rules, nothing about recipients).
//
//   BASE_URL=http://localhost:3100 DATABASE_PATH=./data/e2e.db tsx scripts/e2e-walkthrough.ts
//
// The server must share DATABASE_PATH with this script. The script uses the database directly in only a few
// ways, each standing in for something an operator does or for time passing: granting the first admin role (like
// `npm run admin:grant`), moving a pickup window or a request's creation time (there is no way to wait days), and
// running the purge and sweep jobs (like the daily and 15-minute cron). Everything else goes through the HTTP API.
import fs from "node:fs";
import { getDb } from "../src/lib/db";
import { purgePickups } from "../src/lib/services/pickups";
import { sweep } from "../src/lib/services/sweep";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const TZ = "America/Toronto";
const ADDRESS = "742 Evergreen Terrace, Apt 9Z";
const NOTES = "Side door past the blue gate";
const PHONE = "519-555-0177";
const SECRETS = [ADDRESS, "Evergreen", NOTES, "blue gate", PHONE, "555-0177"];

let failures = 0;
const results: string[] = [];
function check(name: string, ok: boolean, extra = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : extra ? `  -> ${extra}` : ""}`);
  if (!ok) failures++;
}

// Every response body is recorded so we can prove the address never leaks outside the one endpoint that may return it.
const transcript: { who: string; method: string; path: string; status: number; text: string; allowSecret: boolean }[] = [];

class Client {
  cookie = "";
  constructor(public who: string) {}
  async req(method: string, path: string, body?: unknown, o: { headers?: Record<string, string>; allowSecret?: boolean } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { Origin: BASE, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(o.headers ?? {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) {
      const jar = new Map(this.cookie.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]));
      for (const c of set) jar.set(c.split("=")[0], c.split(";")[0]);
      this.cookie = [...jar.values()].join("; ");
    }
    const text = await res.text();
    transcript.push({ who: this.who, method, path, status: res.status, text, allowSecret: !!o.allowSecret });
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML page */
    }
    return { status: res.status, json, text };
  }
  /** The one endpoint allowed to return an address. */
  details(pickupId: string) {
    return this.req("GET", `/api/pickups/${pickupId}`, undefined, { allowSecret: true });
  }
}

const stamp = Date.now();
async function signUp(name: string) {
  // Demo mode only: password sign-up. Production uses Google (see scripts/prod-config-check.ts).
  const c = new Client(name);
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}-${stamp}@example.test`;
  const r = await c.req("POST", "/api/auth/sign-up/email", { name, email, password: "correct-horse-battery" });
  if (r.status !== 200) throw new Error(`sign-up failed: ${r.status} ${JSON.stringify(r.json)}`);
  return { c, email, id: r.json.user.id as string, role: r.json.user.role as string };
}

const localDate = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86400_000));

/** Stand-in for waiting: places a pickup's only window `startInMin` minutes from now. */
function moveWindow(pickupId: string, startInMin: number, lengthMin = 120) {
  const db = getDb();
  const start = new Date(Date.now() + startInMin * 60_000);
  const end = new Date(start.getTime() + lengthMin * 60_000);
  const w = db.prepare("SELECT id FROM pickup_window WHERE pickup_id = ? ORDER BY start_at LIMIT 1").get(pickupId) as { id: string };
  db.prepare("DELETE FROM pickup_window WHERE pickup_id = ? AND id <> ?").run(pickupId, w.id);
  db.prepare("UPDATE pickup_window SET start_at = ?, end_at = ? WHERE id = ?").run(start.toISOString(), end.toISOString(), w.id);
  db.prepare("UPDATE pickup SET scheduled_window_id = ? WHERE id = ?").run(w.id, pickupId);
}

const codeOf = (r: { json: Record<string, any> }) => r.json?.error?.code as string | undefined;


async function main() {
  const guest = new Client("guest");

  // ---- public, no account --------------------------------------------------------------------------------------------
  const health = await guest.req("GET", "/api/health");
  check("health endpoint reports ok", health.status === 200 && health.json.status === "ok", JSON.stringify(health.json));
  const chapters = (await guest.req("GET", "/api/chapters")).json.chapters as { slug: string; name: string; timezone: string }[];
  check("guest sees London and Oshawa without an account", ["london", "oshawa"].every((s) => chapters.some((c) => c.slug === s)), JSON.stringify(chapters));
  const home = await guest.req("GET", "/?chapter=london");
  check("home page shows the live request board", home.status === 200 && home.text.includes("Specific things, from neighbours"));
  check("home page lists what we accept and what we cannot", /What we accept/.test(home.text) && /What we can.?t accept/.test(home.text));
  check("claiming requires sign-in", (await guest.req("POST", "/api/claims", { requestId: "x" })).status === 401);
  check("posting a request requires sign-in", (await guest.req("POST", "/api/requests", { type: "item" })).status === 401);
  check(
    "guest cannot read volunteer, coordinator, partner or admin data",
    (await guest.req("GET", "/api/volunteer")).status === 401 && (await guest.req("GET", "/api/chapters/london/stock")).status === 401 && (await guest.req("GET", "/api/chapters/london/requests")).status === 401 && (await guest.req("GET", "/api/admin/audit")).status === 401,
  );
  const impact0 = (await guest.req("GET", "/api/impact")).json;
  const londonImpact0 = (impact0.chapters as any[]).find((c) => c.slug === "london");

  // ---- accounts and roles -------------------------------------------------------------------------------------------
  const admin = await signUp("E2E Admin");
  check("new accounts start as members", admin.role === "member", admin.role);
  const escalate = await new Client("sneaky").req("POST", "/api/auth/sign-up/email", { name: "Sneaky", email: `sneaky-${stamp}@example.test`, password: "correct-horse-battery", role: "admin" });
  check("sign-up cannot set a role", escalate.status !== 200 || escalate.json.user?.role !== "admin", JSON.stringify(escalate.json).slice(0, 200));
  const upd = await admin.c.req("POST", "/api/auth/update-user", { role: "admin" });
  check("a member cannot make themselves admin through the auth API", ((await admin.c.req("GET", "/api/me")).json.user?.role ?? "") === "member", `status ${upd.status}`);
  check("a member cannot use admin endpoints", (await admin.c.req("GET", "/api/admin/audit")).status === 403 && (await admin.c.req("POST", "/api/chapters", { name: "X Y", city: "Z", timezone: "America/Toronto" })).status === 403);
  const granted = getDb().prepare('UPDATE "user" SET role = ? WHERE id = ?').run("admin", admin.id); // like `npm run admin:grant`
  check("the first admin is granted from the shell (stand-in for npm run admin:grant)", granted.changes === 1);
  check("an admin can read the audit log", (await admin.c.req("GET", "/api/admin/audit?limit=5")).status === 200);

  const lonCoord = await signUp("E2E London Coordinator");
  const oshCoord = await signUp("E2E Oshawa Coordinator");
  const vol1 = await signUp("E2E Volunteer One");
  const vol2 = await signUp("E2E Volunteer Two");
  const vol3 = await signUp("E2E Volunteer Three");
  const oshVol = await signUp("E2E Oshawa Volunteer");
  const neighbour = await signUp("E2E Neighbour");
  const neighbour2 = await signUp("E2E Neighbour Two");
  const stranger = await signUp("E2E Stranger");
  const worker = await signUp("E2E Ark Worker");
  const worker2 = await signUp("E2E Other Worker");
  const oshWorker = await signUp("E2E Oshawa Worker");

  check("an admin appoints a London coordinator", (await admin.c.req("POST", "/api/chapters/london/members", { email: lonCoord.email, role: "coordinator" })).status === 200);
  check("an admin appoints an Oshawa coordinator", (await admin.c.req("POST", "/api/chapters/oshawa/members", { email: oshCoord.email, role: "coordinator" })).status === 200);
  check("a coordinator cannot appoint another coordinator", (await lonCoord.c.req("POST", "/api/chapters/london/members", { email: vol1.email, role: "coordinator" })).status === 403);
  for (const v of [vol1, vol2, vol3]) check(`a London coordinator adds volunteer ${v.email.split("-")[0]}`, (await lonCoord.c.req("POST", "/api/chapters/london/members", { email: v.email, role: "volunteer" })).status === 200);
  check("an Oshawa coordinator adds an Oshawa volunteer", (await oshCoord.c.req("POST", "/api/chapters/oshawa/members", { email: oshVol.email, role: "volunteer" })).status === 200);
  check("a London coordinator cannot add volunteers to Oshawa", (await lonCoord.c.req("POST", "/api/chapters/oshawa/members", { email: vol1.email, role: "volunteer" })).status === 403);
  check("adding an unknown email says so", codeOf(await lonCoord.c.req("POST", "/api/chapters/london/members", { email: "nobody-here@example.test", role: "volunteer" })) === "not_found");

  // ---- a chapter is just data ---------------------------------------------------------------------------------------
  const kingston = await admin.c.req("POST", "/api/chapters", { name: "Kingston (Queen's)", city: "Kingston, ON", timezone: "America/Toronto" });
  check("an admin can start a new chapter with no code change", kingston.status === 200 && kingston.json.chapter?.slug === "kingston", JSON.stringify(kingston.json));
  check("the new chapter is public straight away", ((await guest.req("GET", "/api/chapters/kingston")).json.chapter?.name ?? "") === "Kingston (Queen's)");

  // ---- partners: verification and worker approval --------------------------------------------------------------------
  const items = (await guest.req("GET", "/api/items")).json.items as { id: string; slug: string }[];
  const item = (slug: string) => items.find((i) => i.slug === slug)!.id;
  const zone = await lonCoord.c.req("POST", "/api/chapters/london/zones", { name: "E2E front desk", description: "Public front desk, student centre", hours: "Mon-Fri 10-4" });
  check("a coordinator adds a public drop-off zone", zone.status === 200 && zone.json.zone?.id, JSON.stringify(zone.json));
  const ark = (await lonCoord.c.req("POST", "/api/chapters/london/partners", { name: "E2E Ark Aid", description: "Street mission", excludedItems: "Used underwear" })).json.partner;
  const other = (await lonCoord.c.req("POST", "/api/chapters/london/partners", { name: "E2E Other Agency", description: "Outreach" })).json.partner;
  const oshPartner = (await oshCoord.c.req("POST", "/api/chapters/oshawa/partners", { name: "E2E Harbour", description: "Outreach" })).json.partner;
  check("coordinators add verified partners to their own chapter", !!ark?.id && !!other?.id && !!oshPartner?.id);
  check("a London coordinator cannot add a partner in Oshawa", (await lonCoord.c.req("POST", "/api/chapters/oshawa/partners", { name: "Sneaky Partner" })).status === 403);
  const arkSite = (await lonCoord.c.req("POST", `/api/partners/${ark.id}/sites`, { name: "E2E Ark main building", address: "696 Dundas St", receivingHours: "Mon-Fri 9-4" })).json.site;
  const otherSite = (await lonCoord.c.req("POST", `/api/partners/${other.id}/sites`, { name: "E2E Other hub", address: "1 King St", receivingHours: "Daily 10-2" })).json.site;
  const oshSite = (await oshCoord.c.req("POST", `/api/partners/${oshPartner.id}/sites`, { name: "E2E Harbour site", address: "5 Simcoe St", receivingHours: "Daily 9-5" })).json.site;
  check("coordinators add delivery sites with public address and receiving hours", !!arkSite?.id && !!otherSite?.id && !!oshSite?.id);

  const board0 = (await guest.req("GET", "/api/chapters/london")).json;
  check("the public chapter page lists partners with their delivery sites", (board0.partners as any[]).some((p) => p.id === ark.id && p.sites.some((s: any) => s.id === arkSite.id)));

  const requestBody = (over: Record<string, unknown> = {}) => ({ type: "item", partnerId: ark.id, siteId: arkSite.id, itemId: item("mens-winter-boots"), size: "11", quantity: 4, neededBy: localDate(5), ...over });
  check("a worker who has not asked for access cannot post for the partner", (await worker.c.req("POST", "/api/requests", requestBody())).status === 403);
  check("a worker asks for access to a partner", (await worker.c.req("POST", `/api/partners/${ark.id}/access`)).status === 200);
  const early = await worker.c.req("POST", "/api/requests", requestBody());
  check("...but a pending worker still cannot post", early.status === 403, String(early.status));
  check("a pending worker cannot read the partner's requests", (await worker.c.req("GET", `/api/partners/${ark.id}/requests`)).status === 403);
  check("a stranger cannot approve a worker", (await stranger.c.req("POST", `/api/partners/${ark.id}/workers/${worker.id}`, { decision: "approved" })).status === 403);
  check("an Oshawa coordinator cannot approve a London partner's worker", (await oshCoord.c.req("POST", `/api/partners/${ark.id}/workers/${worker.id}`, { decision: "approved" })).status === 403);
  check("the London coordinator sees the pending worker in approvals", ((await lonCoord.c.req("GET", "/api/chapters/london/approvals")).json.approvals.workers as any[]).some((w) => w.userId === worker.id));
  check("the London coordinator approves the worker", (await lonCoord.c.req("POST", `/api/partners/${ark.id}/workers/${worker.id}`, { decision: "approved" })).status === 200);
  for (const [w, p] of [[worker2, other], [oshWorker, oshPartner]] as const) {
    await w.c.req("POST", `/api/partners/${p.id}/access`);
    await (p === oshPartner ? oshCoord : lonCoord).c.req("POST", `/api/partners/${p.id}/workers/${w.id}`, { decision: "approved" });
  }
  const applied = await stranger.c.req("POST", "/api/partners/apply", { chapter: "london", name: "E2E Unverified Org", description: "Applied via the app" });
  check("anyone can apply for a new partner, which starts unverified", applied.status === 200 && applied.json.partner?.status === "pending", JSON.stringify(applied.json));
  check("an unverified partner cannot have sites used for requests", (await stranger.c.req("POST", "/api/requests", requestBody({ partnerId: applied.json.partner.id }))).status === 403);
  check("an unverified partner is not on the public board's partner list", !((await guest.req("GET", "/api/chapters/london")).json.partners as any[]).some((p) => p.id === applied.json.partner.id));

  // ---- the worker posts requests ------------------------------------------------------------------------------------
  const bad = async (over: Record<string, unknown>) => (await worker.c.req("POST", "/api/requests", requestBody(over))).status;
  check("a request with a missing size is refused", (await bad({ size: "" })) === 422);
  check("a request with an invalid size is refused", (await bad({ size: "99" })) === 422);
  check("a request needed in the past is refused", (await bad({ neededBy: localDate(-1) })) === 422);
  check("a note that looks like it identifies a person is refused", (await bad({ note: "For John Smith, the man by the bridge, call 519-555-0100" })) === 422);
  check("a request with unknown fields (e.g. a recipient) is refused", (await bad({ recipient: "man by the bridge" })) === 422);
  check("a worker cannot post for another partner's site", (await worker.c.req("POST", "/api/requests", requestBody({ siteId: otherSite.id }))).status === 422);
  check("a worker cannot post for another partner", (await worker.c.req("POST", "/api/requests", requestBody({ partnerId: other.id, siteId: otherSite.id }))).status === 403);
  check("the Oshawa worker cannot post for a London partner", (await oshWorker.c.req("POST", "/api/requests", requestBody())).status === 403);
  const urgent = await worker.c.req("POST", "/api/requests", requestBody({ itemId: item("sweatshirt"), size: "L", quantity: 2, urgency: "urgent", neededBy: localDate(2), note: "Needed for outreach" }));
  const made = await worker.c.req("POST", "/api/requests", requestBody());
  check("an approved worker posts a request (item, size, quantity, needed-by, site)", made.status === 200 && !!made.json.id && urgent.status === 200, JSON.stringify(made.json));
  const requestId = made.json.id as string;
  const last = (await worker.c.req("GET", `/api/partners/${ark.id}/last-request`)).json.last;
  check("the worker can repeat their last request in one tap", last?.itemId === item("mens-winter-boots") && last.size === "11" && last.quantity === 4 && last.siteId === arkSite.id, JSON.stringify(last));
  const boardNow = (await guest.req("GET", "/api/chapters/london")).json.board as any[];
  check("the board shows the urgent request before the normal one", boardNow.findIndex((c) => c.requestId === urgent.json.id) < boardNow.findIndex((c) => c.requestId === requestId) && boardNow.findIndex((c) => c.requestId === urgent.json.id) >= 0);
  const card = boardNow.find((c) => c.requestId === requestId);
  check("the card shows item, size, quantity, partner and needed-by", card.label.includes("11") && card.quantity === 4 && card.partnerName === "E2E Ark Aid" && card.neededBy === localDate(5) && card.remaining === 4, JSON.stringify(card));
  check("the card carries the partner's exclusions and new-only flag for the claim form", card.excluded === "Used underwear" && typeof card.newOnly === "boolean");
  check("the request is not on Oshawa's board", !((await guest.req("GET", "/api/chapters/oshawa")).json.board as any[]).some((c) => c.requestId === requestId));
  check("filtering the board by category works", ((await guest.req("GET", "/api/chapters/london?category=footwear")).json.board as any[]).some((c) => c.requestId === requestId) && !((await guest.req("GET", "/api/chapters/london?category=hygiene")).json.board as any[]).some((c) => c.requestId === requestId));
  const own = (await worker.c.req("GET", `/api/partners/${ark.id}/requests`)).json.requests as any[];
  check("the worker sees their own partner's requests", own.some((r) => r.id === requestId));
  check("another partner's worker cannot see them", (await worker2.c.req("GET", `/api/partners/${ark.id}/requests`)).status === 403);
  check("another partner's worker cannot cancel or confirm them", (await worker2.c.req("POST", `/api/requests/${requestId}/cancel`)).status === 404 && (await worker2.c.req("POST", `/api/requests/${requestId}/confirm`)).status === 404);
  check("a neighbour cannot read the triage view", (await neighbour.c.req("GET", "/api/chapters/london/requests")).status === 403);
  const triage = (await lonCoord.c.req("GET", "/api/chapters/london/requests")).json.requests as any[];
  check("the coordinator's triage lists it, with the urgent one flagged at risk", triage.some((r) => r.id === requestId) && triage.find((r) => r.id === urgent.json.id)?.atRisk === true);

  // ---- neighbour claims with a pickup -----------------------------------------------------------------------------------
  const win = (days: number, start = "10:00", end = "12:00") => ({ date: localDate(days), start, end });
  const claimBody = (over: Record<string, unknown> = {}) => ({ requestId, quantity: 3, method: "pickup", address: ADDRESS, notes: NOTES, phone: PHONE, windows: [win(3), win(4, "13:00", "15:00")], ...over });
  check("pickup windows before 09:00 are refused", (await neighbour.c.req("POST", "/api/claims", claimBody({ windows: [win(3, "07:00", "09:00")] }))).status === 422);
  check("pickup windows after 20:00 are refused", (await neighbour.c.req("POST", "/api/claims", claimBody({ windows: [win(3, "19:00", "21:00")] }))).status === 422);
  check("pickup windows in the past are refused", (await neighbour.c.req("POST", "/api/claims", claimBody({ windows: [win(-1)] }))).status === 422);
  check("claiming more than is still needed is refused", codeOf(await neighbour.c.req("POST", "/api/claims", claimBody({ quantity: 5 }))) === "quantity_exceeded");
  check("a claim with unknown fields is refused", (await neighbour.c.req("POST", "/api/claims", claimBody({ recipient: "man by the bridge" }))).status === 422);
  check("the worker cannot claim their own partner's request", (await worker.c.req("POST", "/api/claims", { requestId, quantity: 1, method: "dropoff", zoneId: zone.json.zone.id, expectedDate: localDate(2) })).status === 422);
  const claimed = await neighbour.c.req("POST", "/api/claims", claimBody());
  check("a signed-in neighbour claims part of the request with a pickup", claimed.status === 200 && !!claimed.json.id, JSON.stringify(claimed.json));
  const claimId = claimed.json.id as string;
  const mine = (await neighbour.c.req("GET", "/api/claims")).json.claims as any[];
  const pickupId = mine.find((c) => c.id === claimId).pickup.id as string;
  check("My claims lists it as claimed, with 0 of 2 volunteers and an auto-release time", mine[0].status === "claimed" && mine[0].pickup.volunteerCount === 0 && typeof mine[0].releaseAt === "string", JSON.stringify(mine[0]));
  check("My claims never includes the address, notes or phone", !SECRETS.some((x) => JSON.stringify(mine).includes(x)));
  const card1 = ((await guest.req("GET", "/api/chapters/london")).json.board as any[]).find((c) => c.requestId === requestId);
  check("the board now shows only 1 left to claim (partial claims are allowed)", card1.remaining === 1, JSON.stringify(card1));
  const limitIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await worker.c.req("POST", "/api/requests", requestBody({ itemId: item("socks"), size: "", quantity: 1, neededBy: localDate(6) }));
    const c = await neighbour.c.req("POST", "/api/claims", claimBody({ requestId: r.json.id, quantity: 1, windows: [win(5 + i)] }));
    if (c.json.id) limitIds.push(c.json.id);
  }
  const r4 = await worker.c.req("POST", "/api/requests", requestBody({ itemId: item("socks"), size: "", quantity: 1, neededBy: localDate(6) }));
  const fourth = await neighbour.c.req("POST", "/api/claims", claimBody({ requestId: r4.json.id, quantity: 1, windows: [win(5)] }));
  check("a neighbour can have at most 3 open pickup claims", limitIds.length === 2 && fourth.status === 409 && codeOf(fourth) === "pickup_limit", `${limitIds.length} ${fourth.status}`);
  for (const id of limitIds) await neighbour.c.req("POST", `/api/claims/${id}/cancel`);
  check("cancelling frees a pickup slot", (await neighbour.c.req("POST", "/api/claims", claimBody({ requestId: r4.json.id, quantity: 1, windows: [win(5)] }))).status === 200);
  for (const c of ((await neighbour.c.req("GET", "/api/claims")).json.claims as any[]).filter((c) => c.id !== claimId && c.status === "claimed")) await neighbour.c.req("POST", `/api/claims/${c.id}/cancel`);

  // ---- who can see the claim and the address ------------------------------------------------------------------------
  check("another neighbour cannot read this claim", (await neighbour2.c.req("GET", `/api/claims/${claimId}`)).status === 404);
  check("another neighbour cannot cancel it", (await neighbour2.c.req("POST", `/api/claims/${claimId}/cancel`)).status === 404);
  for (const [who, c] of [["a stranger", stranger.c], ["another neighbour", neighbour2.c], ["an unassigned volunteer", vol3.c], ["the Oshawa coordinator", oshCoord.c], ["the Oshawa volunteer", oshVol.c], ["the partner's worker", worker.c]] as const) {
    const r = await c.details(pickupId);
    check(`${who} gets 404 for the pickup details`, r.status === 404 && !SECRETS.some((x) => r.text.includes(x)), String(r.status));
  }
  check("a guest gets 401 for the pickup details", (await guest.req("GET", `/api/pickups/${pickupId}`)).status === 401);
  const pre = await neighbour.c.details(pickupId);
  check("the neighbour can see their own details (and it is logged)", pre.status === 200 && pre.json.details.address === ADDRESS && pre.json.details.viewedAs === "neighbour");

  // ---- coordinator assigns two volunteers ------------------------------------------------------------------------------
  const unacked = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol1.id });
  check("a volunteer who has not acknowledged the Safety rules cannot be assigned", unacked.status === 409 && codeOf(unacked) === "safety_not_acknowledged", JSON.stringify(unacked.json));
  for (const v of [vol1, vol2]) check("a volunteer acknowledges the Safety rules (timestamped)", (await v.c.req("POST", "/api/safety/ack")).json.acknowledgedAt?.includes("T"));
  check("an Oshawa coordinator cannot assign a volunteer to a London pickup", [403, 404].includes((await oshCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol1.id })).status));
  check("a volunteer cannot assign people", (await vol1.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol2.id })).status === 403);
  const a1 = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol1.id });
  check("the coordinator assigns the first volunteer", a1.status === 200 && a1.json.scheduled === false, JSON.stringify(a1.json));
  const windows = (await neighbour.c.req("GET", `/api/claims/${claimId}`)).json.claim.pickup.windows as { id: string }[];
  const confirm = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/window`, { windowId: windows[0].id });
  check("with one volunteer the pickup cannot be scheduled (two-person rule)", confirm.status === 200 && confirm.json.scheduled === false);
  const forced = await lonCoord.c.req("POST", `/api/claims/${claimId}/status`, { status: "scheduled" });
  check("scheduling by hand with one volunteer is refused", forced.status === 409 && codeOf(forced) === "two_volunteers_required", JSON.stringify(forced.json));
  const a2 = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol2.id });
  check("the second volunteer completes the pair and the pickup becomes scheduled", a2.status === 200 && a2.json.scheduled === true, JSON.stringify(a2.json));
  check("the neighbour sees it scheduled", (await neighbour.c.req("GET", `/api/claims/${claimId}`)).json.claim.status === "scheduled");
  check("the request stays open while one unit is unclaimed", ((await worker.c.req("GET", `/api/partners/${ark.id}/requests`)).json.requests as any[]).find((r) => r.id === requestId).status === "open");
  const board = (await lonCoord.c.req("GET", "/api/chapters/london/pickups")).json.board;
  check("the coordinator's pickup board shows it as scheduled with no address", board.scheduled.length + board.today.length >= 1 && !SECRETS.some((x) => JSON.stringify(board).includes(x)));
  const slots = (await vol3.c.req("GET", "/api/volunteer")).json;
  check("volunteer view lists no slot that is already full", !(slots.slots as any[]).some((x) => x.pickupId === pickupId));

  // ---- the address only appears inside the allowed window ---------------------------------------------------------------
  const tooSoon = await vol1.c.details(pickupId);
  check("days ahead, the assigned volunteer cannot see the address", tooSoon.status === 403 && codeOf(tooSoon) === "not_yet_visible" && !SECRETS.some((x) => tooSoon.text.includes(x)), tooSoon.text.slice(0, 200));
  check("...and is told when it will appear", typeof tooSoon.json.error?.details?.visibleFrom === "string");
  check("days ahead, the coordinator cannot see it either", (await lonCoord.c.details(pickupId)).status === 403);
  const volPage = await vol1.c.req("GET", "/volunteer");
  check("the volunteer page (HTML) does not contain the address", volPage.status === 200 && !SECRETS.some((x) => volPage.text.includes(x)));
  const mineVol = (await vol1.c.req("GET", "/api/volunteer")).json;
  check("volunteer API shows the pickup, the partner and that the address is not visible yet", mineVol.assignments[0]?.addressVisibleNow === false && mineVol.assignments[0].partners.length === 1, JSON.stringify(mineVol.assignments));

  moveWindow(pickupId, 180); // window starts in 3 hours: inside 24 hours before
  const vis = await vol1.c.details(pickupId);
  check("within 24 hours of the window the assigned volunteer sees the address", vis.status === 200 && vis.json.details.address === ADDRESS && vis.json.details.phone === PHONE, String(vis.status));
  check("...and so does the coordinator", (await lonCoord.c.details(pickupId)).json.details?.address === ADDRESS);
  check("...but an unassigned volunteer, a stranger and the Oshawa coordinator still do not", (await vol3.c.details(pickupId)).status === 404 && (await stranger.c.details(pickupId)).status === 404 && (await oshCoord.c.details(pickupId)).status === 404);
  const audit = (await lonCoord.c.req("GET", "/api/chapters/london/audit?action=address_viewed&limit=50")).json.events as any[];
  const viewers = new Set(audit.filter((e) => e.subjectId === pickupId).map((e) => e.actorName));
  check("every address view is in the audit log (neighbour, volunteer, coordinator)", ["E2E Neighbour", "E2E Volunteer One", "E2E London Coordinator"].every((n) => viewers.has(n)), JSON.stringify([...viewers]));
  check("the audit log never contains the address", !SECRETS.some((x) => JSON.stringify(audit).includes(x)));
  check("only coordinators of that chapter can read the chapter audit log", (await oshCoord.c.req("GET", "/api/chapters/london/audit")).status === 403 && (await vol1.c.req("GET", "/api/chapters/london/audit")).status === 403);

  // ---- check-in and check-out -------------------------------------------------------------------------------------------
  const tooEarly = await vol1.c.req("POST", `/api/pickups/${pickupId}/arrive`);
  check("check-in is refused more than an hour before the window", tooEarly.status === 409 && codeOf(tooEarly) === "too_early", JSON.stringify(tooEarly.json));
  moveWindow(pickupId, 30); // window starts in 30 minutes
  check("check-out before arriving is refused", codeOf(await vol1.c.req("POST", `/api/pickups/${pickupId}/complete`, { outcome: "collected" })) === "not_arrived");
  check("volunteer one taps Arrived", (await vol1.c.req("POST", `/api/pickups/${pickupId}/arrive`)).status === 200);
  check("volunteer two taps Arrived", (await vol2.c.req("POST", `/api/pickups/${pickupId}/arrive`)).status === 200);
  check("an unassigned volunteer cannot check in", (await vol3.c.req("POST", `/api/pickups/${pickupId}/arrive`)).status === 404);
  const d1 = await vol1.c.req("POST", `/api/pickups/${pickupId}/complete`, { outcome: "collected" });
  check("volunteer one taps Done: the claim waits for the pair", d1.status === 200 && d1.json.closedAs === null && (await neighbour.c.req("GET", `/api/claims/${claimId}`)).json.claim.status === "scheduled", JSON.stringify(d1.json));
  const d2 = await vol2.c.req("POST", `/api/pickups/${pickupId}/complete`, { outcome: "collected" });
  check("volunteer two taps Done: the claim is collected", d2.status === 200 && d2.json.closedAs === "collected" && (await neighbour.c.req("GET", `/api/claims/${claimId}`)).json.claim.status === "collected", JSON.stringify(d2.json));
  const after = await vol1.c.details(pickupId);
  check("once the pickup is closed volunteers and coordinators no longer see the address", after.status === 403 && (await lonCoord.c.details(pickupId)).status === 403);
  check("the neighbour still sees their own details until the purge", (await neighbour.c.details(pickupId)).json.details?.address === ADDRESS);

  // ---- received: the last unit arrives by drop-off, then the request is complete ------------------------------------------
  const drop = await neighbour2.c.req("POST", "/api/claims", { requestId, quantity: 1, method: "dropoff", zoneId: zone.json.zone.id, expectedDate: localDate(1) });
  check("a second neighbour claims the last unit as a drop-off (scheduled straight away)", drop.status === 200, JSON.stringify(drop.json));
  const dropId = drop.json.id as string;
  check("the drop-off shows in the coordinator's incoming list", ((await lonCoord.c.req("GET", "/api/chapters/london/dropoffs")).json.dropoffs as any[]).some((r) => r.claimId === dropId));
  const receiving = (await lonCoord.c.req("GET", "/api/chapters/london/receiving")).json.claims as any[];
  check("the collected pickup and the drop-off are waiting to be counted", receiving.some((r) => r.claimId === claimId) && receiving.some((r) => r.claimId === dropId));
  check("an Oshawa coordinator cannot count London's claim", [403, 404].includes((await oshCoord.c.req("POST", `/api/claims/${claimId}/receive`, { quantity: 3 })).status));
  check("counting needs a quantity", (await lonCoord.c.req("POST", `/api/claims/${claimId}/receive`, {})).status === 422);
  const recv1 = await lonCoord.c.req("POST", `/api/claims/${claimId}/receive`, { quantity: 3, extras: [{ itemId: item("gloves"), size: "", quantity: 2 }], note: "E2E: two extra pairs of gloves" });
  check("the coordinator counts 3 boots (plus 2 unclaimed gloves into stock)", recv1.status === 200 && recv1.json.received === 5 && recv1.json.allocatedToRequest === 3, JSON.stringify(recv1.json));
  check("receiving twice is refused", (await lonCoord.c.req("POST", `/api/claims/${claimId}/receive`, { quantity: 3 })).status === 409);
  const recv2 = await lonCoord.c.req("POST", `/api/claims/${dropId}/receive`, { quantity: 1 });
  check("the drop-off is counted, which completes the request", recv2.status === 200, JSON.stringify(recv2.json));
  const stock = (await lonCoord.c.req("GET", "/api/chapters/london/stock")).json;
  check("the stock ledger records the receipt, the allocation and the extras", ["received", "allocated_to_request"].every((k) => (stock.ledger as any[]).some((l) => l.kind === k)));
  check("the extra gloves went to stock", ((stock.stock as any[]).find((r) => r.name === "Gloves or mittens")?.stock ?? 0) >= 2);
  const triage2 = (await lonCoord.c.req("GET", "/api/chapters/london/requests")).json.requests as any[];
  check("the request is now in hand (in transit) and no longer on the board", triage2.find((r) => r.id === requestId)?.status === "in_transit" && !((await guest.req("GET", "/api/chapters/london")).json.board as any[]).some((c) => c.requestId === requestId));

  // ---- delivery to the agency -----------------------------------------------------------------------------------------------
  const deliverables = (await lonCoord.c.req("GET", "/api/chapters/london/deliverables")).json.deliverables as any[];
  check("the request appears in the deliverables for the right site", deliverables.some((r) => r.requestId === requestId && r.siteId === arkSite.id));
  check("an Oshawa coordinator cannot read London's deliverables", (await oshCoord.c.req("GET", "/api/chapters/london/deliverables")).status === 403);
  check("a delivery cannot mix sites", (await lonCoord.c.req("POST", "/api/chapters/london/deliveries", { siteId: otherSite.id, requestIds: [requestId], plannedFor: localDate(0) })).status === 422);
  const delivery = await lonCoord.c.req("POST", "/api/chapters/london/deliveries", { siteId: arkSite.id, requestIds: [requestId], plannedFor: localDate(0) });
  check("the coordinator plans a delivery run to the Ark Aid site", delivery.status === 200 && !!delivery.json.id, JSON.stringify(delivery.json));
  const deliveryId = delivery.json.id as string;
  check("a delivery cannot go out with no volunteer", codeOf(await lonCoord.c.req("POST", `/api/deliveries/${deliveryId}/start`)) === "no_volunteers");
  check("a coordinator assigns a volunteer to the run", (await lonCoord.c.req("POST", `/api/deliveries/${deliveryId}/assign`, { volunteerId: vol1.id })).status === 200);
  const myRun = (await vol1.c.req("GET", "/api/volunteer")).json.deliveries as any[];
  check("the volunteer's view shows the batch with the site's receiving hours", myRun.some((d) => d.id === deliveryId && d.site.receivingHours === "Mon-Fri 9-4"), JSON.stringify(myRun));
  check("an unassigned volunteer cannot start it", (await vol3.c.req("POST", `/api/deliveries/${deliveryId}/start`)).status === 404);
  check("the volunteer starts the run", (await vol1.c.req("POST", `/api/deliveries/${deliveryId}/start`)).status === 200);
  check("a request cannot be confirmed before it is delivered", codeOf(await worker.c.req("POST", `/api/requests/${requestId}/confirm`)) === "not_delivered");
  check("the volunteer completes the delivery", (await vol1.c.req("POST", `/api/deliveries/${deliveryId}/complete`)).status === 200);
  getDb().prepare("UPDATE request SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 30 * 3600_000).toISOString(), requestId); // stands in for 30 hours of waiting
  const delivered = ((await worker.c.req("GET", `/api/partners/${ark.id}/requests`)).json.requests as any[]).find((r) => r.id === requestId);
  check("the worker sees it delivered and can confirm receipt", delivered.status === "delivered" && delivered.canConfirm === true, JSON.stringify(delivered));
  check("another partner's worker cannot confirm it", (await worker2.c.req("POST", `/api/requests/${requestId}/confirm`)).status === 404);
  check("the worker confirms receipt", (await worker.c.req("POST", `/api/requests/${requestId}/confirm`)).status === 200);
  check("confirming twice is refused", (await worker.c.req("POST", `/api/requests/${requestId}/confirm`)).status === 409);
  const view = (await neighbour.c.req("GET", `/api/claims/${claimId}`)).json.claim;
  check("the neighbour sees “Delivered to [partner]” with a date", view.delivered?.partnerName === "E2E Ark Aid" && typeof view.delivered.at === "string" && view.delivered.confirmed === true, JSON.stringify(view.delivered));
  const myClaimsPage = await neighbour.c.req("GET", "/claims");
  check("the My claims page says where it went", myClaimsPage.status === 200 && /Delivered to/.test(myClaimsPage.text) && myClaimsPage.text.includes("E2E Ark Aid"));

  // ---- a second request filled straight from stock -------------------------------------------------------------------------
  const brush = await worker.c.req("POST", "/api/requests", requestBody({ itemId: item("wet-wipes"), size: "", quantity: 5, urgency: "urgent", neededBy: localDate(2) }));
  const brushId = brush.json.id as string;
  check("fill-from-stock is refused when the shelf is short", codeOf(await lonCoord.c.req("POST", `/api/requests/${brushId}/fill`)) === "insufficient_stock");
  check("a worker cannot fill from stock", (await worker.c.req("POST", `/api/requests/${brushId}/fill`)).status === 403);
  check("an Oshawa coordinator cannot fill a London request", [403, 404].includes((await oshCoord.c.req("POST", `/api/requests/${brushId}/fill`)).status));
  check("the coordinator counts 8 packs of wet wipes onto the shelf", (await lonCoord.c.req("POST", "/api/chapters/london/stock", { kind: "adjusted", itemId: item("wet-wipes"), size: "", delta: 8, note: "E2E opening count" })).status === 200);
  check("stock can never go negative", codeOf(await lonCoord.c.req("POST", "/api/chapters/london/stock", { kind: "discarded", itemId: item("wet-wipes"), size: "", quantity: 9, note: "too many" })) === "insufficient_stock");
  const filled = await lonCoord.c.req("POST", `/api/requests/${brushId}/fill`);
  check("fill from stock sends the request straight to delivery", filled.status === 200 && filled.json.status === "in_transit", JSON.stringify(filled.json));
  check("the stock came off the shelf", ((await lonCoord.c.req("GET", "/api/chapters/london/stock")).json.stock as any[]).find((r) => r.name === "Wet wipes")?.stock === 3);
  const delivery2 = await lonCoord.c.req("POST", "/api/chapters/london/deliveries", { siteId: arkSite.id, requestIds: [brushId], plannedFor: localDate(0) });
  await lonCoord.c.req("POST", `/api/deliveries/${delivery2.json.id}/assign`, { volunteerId: vol2.id });
  await vol2.c.req("POST", `/api/deliveries/${delivery2.json.id}/start`);
  check("the same-day delivery is completed and confirmed", (await vol2.c.req("POST", `/api/deliveries/${delivery2.json.id}/complete`)).status === 200 && (await worker.c.req("POST", `/api/requests/${brushId}/confirm`)).status === 200);

  // ---- impact -------------------------------------------------------------------------------------------------------------
  const impact1 = ((await guest.req("GET", "/api/impact")).json.chapters as any[]).find((c) => c.slug === "london");
  check("the public impact numbers count both new deliveries", impact1.fulfilled === londonImpact0.fulfilled + 2, `${londonImpact0.fulfilled} -> ${impact1.fulfilled}`);
  check("they report a median time to delivery and the share inside 72 hours", typeof impact1.medianHours === "number" && typeof impact1.within72hPct === "number");
  check("they split requests filled from stock and from neighbour claims", impact1.fromStockPct > 0 && impact1.fromClaimsPct > 0 && impact1.fromStockPct + impact1.fromClaimsPct === 100, JSON.stringify([impact1.fromStockPct, impact1.fromClaimsPct]));
  check("this week's bar went up and the partner shows up in the per-partner counts", impact1.weekly.at(-1).fulfilled >= 2 && impact1.byPartner.some((p: any) => p.name === "E2E Ark Aid" && p.fulfilled === 2), JSON.stringify(impact1.byPartner));
  check("volunteer hours and active neighbours are reported", typeof impact1.volunteerHours === "number" && impact1.activeNeighbours >= 2);
  check("impact numbers are counts only (no names, ids or people)", !/E2E (Neighbour|Volunteer|Ark Worker)|@example/.test(JSON.stringify(impact1)));
  const impactPage = await guest.req("GET", "/impact");
  check("the impact page renders and leads with the median time to delivery", impactPage.status === 200 && impactPage.text.indexOf("Median time from request to delivery") > 0 && impactPage.text.indexOf("Median time from request to delivery") < impactPage.text.indexOf("per week"));

  // ---- restock requests keep the board live -------------------------------------------------------------------------------------
  check("a coordinator sets a restock target", (await lonCoord.c.req("PUT", "/api/chapters/london/stock/targets", { itemId: item("wet-wipes"), size: "", target: 20 })).status === 200);
  const restock = ((await guest.req("GET", "/api/chapters/london")).json.board as any[]).find((c) => c.type === "restock" && c.label.includes("Wet wipes"));
  check("being below target posts a restock request on the board, with no partner", !!restock && restock.partnerName === null && restock.remaining === 17, JSON.stringify(restock));
  check("restock requests carry a different type so the board can show them apart", restock?.type === "restock");

  // ---- claims nobody schedules are released --------------------------------------------------------------------------------------
  const lone = await worker.c.req("POST", "/api/requests", requestBody({ itemId: item("backpack"), size: "", quantity: 1, neededBy: localDate(5) }));
  const loneClaim = await neighbour2.c.req("POST", "/api/claims", claimBody({ requestId: lone.json.id, quantity: 1, windows: [win(3)] }));
  check("a pickup claim starts with a release time 48 hours out", loneClaim.status === 200 && ((await neighbour2.c.req("GET", `/api/claims/${loneClaim.json.id}`)).json.claim.releaseAt as string) > new Date(Date.now() + 47 * 3600_000).toISOString());
  check("a claim in progress takes the request off the board", !((await guest.req("GET", "/api/chapters/london")).json.board as any[]).some((c) => c.requestId === lone.json.id));
  getDb().prepare("UPDATE claim SET release_at = ? WHERE id = ?").run(new Date(Date.now() - 3600_000).toISOString(), loneClaim.json.id); // stands in for 48 hours passing
  const swept = sweep(); // like the 15-minute cron
  check("the sweep job releases an unscheduled claim", swept.released >= 1, JSON.stringify(swept));
  check("the released claim is cancelled and the request is back on the board", (await neighbour2.c.req("GET", `/api/claims/${loneClaim.json.id}`)).json.claim.status === "cancelled" && ((await guest.req("GET", "/api/chapters/london")).json.board as any[]).some((c) => c.requestId === lone.json.id));

  // ---- the address is purged ----------------------------------------------------------------------------------------------
  const raw = () => [process.env.DATABASE_PATH!, process.env.DATABASE_PATH + "-wal"].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f).toString("latin1")).join("");
  check("the address, notes and phone are not stored in plaintext anywhere in the database files", !SECRETS.some((x) => raw().includes(x)));
  const row = () => getDb().prepare("SELECT address_enc, notes_enc, phone_enc, purged_at FROM pickup WHERE id = ?").get(pickupId) as Record<string, string | null>;
  check("before the purge the encrypted details are stored", !!row().address_enc && row().address_enc !== ADDRESS && !!row().notes_enc && !!row().phone_enc);
  check("the purge job does nothing before 7 days", purgePickups() >= 0 && !!row().address_enc);
  getDb().prepare("UPDATE claim SET closed_at = ? WHERE id = ?").run(new Date(Date.now() - 8 * 86400_000).toISOString(), claimId); // stands in for 8 days passing
  const purged = purgePickups();
  check("the purge job erases it 7+ days after the pickup closed", purged >= 1 && row().address_enc === null && row().notes_enc === null && row().phone_enc === null && !!row().purged_at, JSON.stringify(row()));
  const gone = await neighbour.c.details(pickupId);
  check("the neighbour is told the details were erased", gone.status === 410 && codeOf(gone) === "details_purged", String(gone.status));
  check("My claims says the details were erased", (await neighbour.c.req("GET", `/api/claims/${claimId}`)).json.claim.pickup.detailsPurged === true);

  // ---- cross-chapter and cross-partner checks ---------------------------------------------------------------------------------------
  for (const path of ["pickups", "stock", "receiving", "dropoffs", "members", "audit", "kit-templates", "zones", "partners", "reports", "requests", "deliveries", "deliverables", "approvals", "shifts", "kits"]) {
    const r = await oshCoord.c.req("GET", `/api/chapters/london/${path}`);
    check(`Oshawa coordinator is refused London's ${path}`, r.status === 403, String(r.status));
  }
  for (const path of ["pickups", "stock", "members", "audit", "requests", "approvals"]) {
    check(`London coordinator is refused Oshawa's ${path}`, (await lonCoord.c.req("GET", `/api/chapters/oshawa/${path}`)).status === 403);
  }
  const oshReq = await oshWorker.c.req("POST", "/api/requests", { type: "item", partnerId: oshPartner.id, siteId: oshSite.id, itemId: item("scarf"), size: "", quantity: 2, neededBy: localDate(4) });
  check("the Oshawa worker posts in Oshawa", oshReq.status === 200, JSON.stringify(oshReq.json));
  check("a London coordinator cannot fill, cancel or confirm an Oshawa request", [403, 404].includes((await lonCoord.c.req("POST", `/api/requests/${oshReq.json.id}/fill`)).status) && [403, 404].includes((await lonCoord.c.req("POST", `/api/requests/${oshReq.json.id}/cancel`)).status));
  check("a London worker cannot read Oshawa's partner requests", (await worker.c.req("GET", `/api/partners/${oshPartner.id}/requests`)).status === 403);
  check("a London worker cannot add sites to an Oshawa partner or change it", (await worker.c.req("POST", `/api/partners/${oshPartner.id}/sites`, { name: "x y", address: "123 Fake St" })).status === 403 && (await worker.c.req("PATCH", `/api/partners/${oshPartner.id}`, { name: "Hijacked" })).status === 403);
  check("a worker cannot edit their own partner's verification or sites", (await worker.c.req("POST", `/api/partners/${ark.id}/decision`, { decision: "approved" })).status === 403 && (await worker.c.req("PATCH", `/api/sites/${arkSite.id}`, { address: "Elsewhere 1" })).status === 403);
  check("an Oshawa coordinator cannot post a kit template or stock change in London", (await oshCoord.c.req("POST", "/api/chapters/london/stock", { kind: "adjusted", itemId: item("scarf"), size: "", delta: 5, note: "x" })).status === 403);
  check("a plain member cannot use the coordinator API", (await stranger.c.req("GET", "/api/chapters/london/pickups")).status === 403 && (await stranger.c.req("GET", "/api/chapters/london/requests")).status === 403);
  const html = await Promise.all([neighbour.c, vol1.c, lonCoord.c, admin.c, worker.c].map((c) => c.req("GET", "/claims")));
  const partnerPages = await Promise.all([worker.c, neighbour.c].map((c) => c.req("GET", "/partner")));
  const coordPages = await Promise.all(["requests", "pickups", "reports", "audit", "receive", "dropoffs", "deliveries", "stock"].map((t) => lonCoord.c.req("GET", `/coordinate/london?tab=${t}`)));
  check("no server-rendered page contains the address", [...html, ...partnerPages, ...coordPages].every((r) => !SECRETS.some((x) => r.text.includes(x))));
  const leaked = transcript.filter((t) => !t.allowSecret && SECRETS.some((x) => t.text.includes(x)));
  check(`the address appears in no response except the audited pickup-details endpoint (${transcript.length} responses checked)`, leaked.length === 0, leaked.map((l) => `${l.who} ${l.method} ${l.path}`).join("; "));
  const allowed = transcript.filter((t) => t.allowSecret && t.status === 200 && SECRETS.some((x) => t.text.includes(x)));
  check("and only the neighbour, the assigned volunteer and the coordinator ever got it from that endpoint", allowed.every((t) => ["E2E Neighbour", "E2E Volunteer One", "E2E London Coordinator"].includes(t.who)), [...new Set(allowed.map((a) => a.who))].join(", "));

  // ---- request guard, origin and upload probes -------------------------------------------------------------------------------
  const cross = await neighbour.c.req("POST", "/api/claims", claimBody(), { headers: { Origin: "https://evil.example" } });
  check("a cross-origin claim is rejected", cross.status === 403, String(cross.status));
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "photo.pdf");
  const up = await fetch(BASE + "/api/requests", { method: "POST", headers: { Origin: BASE, Cookie: worker.c.cookie }, body: form });
  check("file uploads are rejected (nothing about recipients can be attached)", up.status === 415, String(up.status));
  check("oversized bodies are rejected", (await fetch(BASE + "/api/requests", { method: "POST", headers: { Origin: BASE, "Content-Type": "application/json", Cookie: worker.c.cookie }, body: JSON.stringify({ x: "y".repeat(120_000) }) })).status === 413);

  // ---- account deletion ---------------------------------------------------------------------------------------------------------
  const delReq = await worker.c.req("POST", "/api/requests", requestBody({ itemId: item("drawstring-bag"), size: "", quantity: 2, neededBy: localDate(5) }));
  const p2 = await neighbour2.c.req("POST", "/api/claims", claimBody({ requestId: delReq.json.id, quantity: 2, address: "9 Delete Me Lane", windows: [win(3)] }));
  const del = await neighbour2.c.req("DELETE", "/api/account", { confirm: "DELETE" });
  const p2row = getDb().prepare("SELECT c.status, c.neighbour_id, k.address_enc FROM claim c JOIN pickup k ON k.claim_id = c.id WHERE c.id = ?").get(p2.json.id) as any;
  check("deleting an account cancels open claims, erases pickup details at once and detaches the neighbour", del.status === 200 && p2row.status === "cancelled" && p2row.address_enc === null && p2row.neighbour_id === null, JSON.stringify(p2row));
  check("the request goes back on the board", ((await guest.req("GET", "/api/chapters/london")).json.board as any[]).some((c) => c.requestId === delReq.json.id));
  check("the deleted neighbour's session no longer works", (await neighbour2.c.req("GET", "/api/claims")).status === 401);

  // ---- recipients are never recorded -----------------------------------------------------------------------------------------
  const cols = (getDb().prepare("SELECT m.name AS t, p.name AS c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table'").all() as { t: string; c: string }[]).map((r) => `${r.t}.${r.c}`);
  check("no table or column in the live database is about recipients", !cols.some((c) => /recipient|client|beneficiar|person_served/i.test(c)));

  console.log(results.join("\n"));
  console.log(failures ? `\n${failures} check(s) failed of ${results.length}` : `\nAll ${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.log(results.join("\n"));
  console.error(e);
  process.exit(2);
});
