// End-to-end walkthrough against a RUNNING server (real HTTP, real auth, real SQLite):
//
//   donor pledges a pickup -> coordinator assigns two volunteers -> a volunteer sees the address only inside the
//   allowed window -> collected -> received into stock -> package assembled -> handed off -> impact page updates
//   -> address purged
//
// plus negative checks (cross-chapter access, address leakage through every API and page, at-rest plaintext,
// role escalation, cross-origin writes, uploads, daytime-window and pickup-limit rules).
//
//   BASE_URL=http://localhost:3100 DATABASE_PATH=./data/e2e.db tsx scripts/e2e-walkthrough.ts
//
// The server must share DATABASE_PATH with this script. The script uses the database directly in only three
// ways, each standing in for something an operator does: granting the first admin role (like `npm run
// admin:grant`), moving a pickup window in time (there is no way to wait 5 days), and running the purge job
// (like the daily cron). Everything else goes through the HTTP API.
import fs from "node:fs";
import { getDb } from "../src/lib/db";
import { purgePickups } from "../src/lib/services/pickups";

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
  const home = await guest.req("GET", "/");
  check("home page shows the live needs board", home.status === 200 && home.text.includes("What we need right now"));
  check("home page lists what we accept and what we cannot", /What we accept/.test(home.text) && /What we can.?t accept/.test(home.text));
  check("pledging requires sign-in", (await guest.req("POST", "/api/pledges", { chapter: "london" })).status === 401);
  check("guest cannot read volunteer, coordinator or admin data", (await guest.req("GET", "/api/volunteer")).status === 401 && (await guest.req("GET", "/api/chapters/london/inventory")).status === 401 && (await guest.req("GET", "/api/admin/audit")).status === 401);
  const impact0 = (await guest.req("GET", "/api/impact")).json.chapters as { slug: string; packagesHandedOff: number; itemsReceived: number }[];
  const londonImpact0 = impact0.find((c) => c.slug === "london")!;

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
  const donor = await signUp("E2E Donor");
  const donor2 = await signUp("E2E Donor Two");
  const stranger = await signUp("E2E Stranger");

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

  // ---- coordinator sets up needs, a zone and a partner ---------------------------------------------------------------
  const items = (await guest.req("GET", "/api/items")).json.items as { id: string; slug: string }[];
  const item = (slug: string) => items.find((i) => i.slug === slug)!.id;
  const need = await lonCoord.c.req("POST", "/api/chapters/london/needs", { itemId: item("socks"), quantity: 12, priority: "urgent", note: "E2E: warm socks" });
  check("a coordinator posts a need", need.status === 200 && need.json.need?.needId, JSON.stringify(need.json));
  const needId = need.json.need.needId as string;
  const board0 = (await guest.req("GET", "/api/chapters/london")).json.board as any[];
  const line0 = board0.find((l) => l.needId === needId);
  check("the public board shows it first (urgent), with progress numbers", board0[0]?.needId === needId && line0.needed === 12 && line0.pledged === 0 && line0.received === 0 && line0.remaining === 12, JSON.stringify(line0));
  check("the same need is not on Oshawa's board", !((await guest.req("GET", "/api/chapters/oshawa")).json.board as any[]).some((l) => l.needId === needId));
  const zone = await lonCoord.c.req("POST", "/api/chapters/london/zones", { name: "E2E front desk", description: "Public front desk, student centre", hours: "Mon-Fri 10-4" });
  check("a coordinator adds a public drop-off zone", zone.status === 200);
  const partner = await lonCoord.c.req("POST", "/api/chapters/london/partners", { name: "E2E Shelter", description: "Emergency shelter" });
  check("a coordinator adds a partner agency", partner.status === 200);

  // ---- donor pledges a pickup ------------------------------------------------------------------------------------------
  const win = (days: number, start = "10:00", end = "12:00") => ({ date: localDate(days), start, end });
  const pledgeBody = (over: Record<string, unknown> = {}) => ({
    chapter: "london", method: "pickup", items: [{ needId, quantity: 4 }], address: ADDRESS, notes: NOTES, phone: PHONE, windows: [win(5), win(6, "13:00", "15:00")], ...over,
  });
  check("pickup windows before 09:00 are refused", (await donor.c.req("POST", "/api/pledges", pledgeBody({ windows: [win(5, "07:00", "09:00")] }))).status === 422);
  check("pickup windows after 20:00 are refused", (await donor.c.req("POST", "/api/pledges", pledgeBody({ windows: [win(5, "19:00", "21:00")] }))).status === 422);
  check("pickup windows in the past are refused", (await donor.c.req("POST", "/api/pledges", pledgeBody({ windows: [win(-1)] }))).status === 422);
  check("pledging more than is still needed is refused", codeOf(await donor.c.req("POST", "/api/pledges", pledgeBody({ items: [{ needId, quantity: 13 }] }))) === "need_exceeded");
  check("a pledge with unknown fields is refused", (await donor.c.req("POST", "/api/pledges", pledgeBody({ recipient: "man by the bridge" }))).status === 422);
  const made = await donor.c.req("POST", "/api/pledges", pledgeBody());
  check("a signed-in donor pledges a pickup", made.status === 200 && made.json.id, JSON.stringify(made.json));
  const pledgeId = made.json.id as string;
  const mine = (await donor.c.req("GET", "/api/pledges")).json.pledges as any[];
  const pickupId = mine.find((p) => p.id === pledgeId).pickup.id as string;
  check("My pledges lists it as pledged with 0 of 2 volunteers", mine[0].status === "pledged" && mine[0].pickup.volunteerCount === 0, JSON.stringify(mine[0]));
  check("My pledges never includes the address, notes or phone", !SECRETS.some((s) => JSON.stringify(mine).includes(s)));
  const line1 = ((await guest.req("GET", "/api/chapters/london")).json.board as any[]).find((l) => l.needId === needId);
  check("the public board now shows 4 pledged", line1.pledged === 4 && line1.remaining === 8, JSON.stringify(line1));
  const limitIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await donor.c.req("POST", "/api/pledges", pledgeBody({ items: [{ needId, quantity: 1 }], windows: [win(7 + i)] }));
    if (r.json.id) limitIds.push(r.json.id);
  }
  const fourth = await donor.c.req("POST", "/api/pledges", pledgeBody({ items: [{ needId, quantity: 1 }], windows: [win(9)] }));
  check("a donor can have at most 3 open pickup pledges", limitIds.length === 2 && fourth.status === 409 && codeOf(fourth) === "pickup_limit", `${limitIds.length} ${fourth.status}`);
  for (const id of limitIds) await donor.c.req("POST", `/api/pledges/${id}/cancel`);
  check("cancelling frees a pickup slot", (await donor.c.req("POST", "/api/pledges", pledgeBody({ items: [{ needId, quantity: 1 }], windows: [win(9)] }))).status === 200);
  const extra = ((await donor.c.req("GET", "/api/pledges")).json.pledges as any[]).filter((p) => p.id !== pledgeId && p.status === "pledged");
  for (const p of extra) await donor.c.req("POST", `/api/pledges/${p.id}/cancel`);

  // ---- who can see the pledge and the address ------------------------------------------------------------------------
  check("another donor cannot read this pledge", (await donor2.c.req("GET", `/api/pledges/${pledgeId}`)).status === 404);
  check("another donor cannot cancel it", (await donor2.c.req("POST", `/api/pledges/${pledgeId}/cancel`)).status === 404);
  for (const [who, c] of [["a stranger", stranger.c], ["another donor", donor2.c], ["an unassigned volunteer", vol3.c], ["the Oshawa coordinator", oshCoord.c], ["the Oshawa volunteer", oshVol.c]] as const) {
    const r = await c.details(pickupId);
    check(`${who} gets 404 for the pickup details`, r.status === 404 && !SECRETS.some((s) => r.text.includes(s)), String(r.status));
  }
  check("a guest gets 401 for the pickup details", (await guest.req("GET", `/api/pickups/${pickupId}`)).status === 401);
  const pre = await donor.c.details(pickupId);
  check("the donor can see their own details (and it is logged)", pre.status === 200 && pre.json.details.address === ADDRESS && pre.json.details.viewedAs === "donor");

  // ---- coordinator assigns two volunteers ------------------------------------------------------------------------------
  const unacked = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol1.id });
  check("a volunteer who has not acknowledged the Safety rules cannot be assigned", unacked.status === 409 && codeOf(unacked) === "safety_not_acknowledged", JSON.stringify(unacked.json));
  for (const v of [vol1, vol2]) check("a volunteer acknowledges the Safety rules (timestamped)", (await v.c.req("POST", "/api/safety/ack")).json.acknowledgedAt?.includes("T"));
  check("an Oshawa coordinator cannot assign a volunteer to a London pickup", [403, 404].includes((await oshCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol1.id })).status));
  check("a volunteer cannot assign people", (await vol1.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol2.id })).status === 403);
  const a1 = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol1.id });
  check("the coordinator assigns the first volunteer", a1.status === 200 && a1.json.scheduled === false, JSON.stringify(a1.json));
  const windows = (await donor.c.req("GET", `/api/pledges/${pledgeId}`)).json.pledge.pickup.windows as { id: string }[];
  const confirm = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/window`, { windowId: windows[0].id });
  check("with one volunteer the pickup cannot be scheduled (two-person rule)", confirm.status === 200 && confirm.json.scheduled === false);
  const forced = await lonCoord.c.req("POST", `/api/pledges/${pledgeId}/status`, { status: "scheduled" });
  check("scheduling by hand with one volunteer is refused", forced.status === 409 && codeOf(forced) === "two_volunteers_required", JSON.stringify(forced.json));
  const a2 = await lonCoord.c.req("POST", `/api/pickups/${pickupId}/assign`, { volunteerId: vol2.id });
  check("the second volunteer completes the pair and the pickup becomes scheduled", a2.status === 200 && a2.json.scheduled === true, JSON.stringify(a2.json));
  check("the donor sees it scheduled", (await donor.c.req("GET", `/api/pledges/${pledgeId}`)).json.pledge.status === "scheduled");
  const board = (await lonCoord.c.req("GET", "/api/chapters/london/pickups")).json.board;
  check("the coordinator's pickup board shows it as scheduled with no address", board.scheduled.length + board.today.length >= 1 && !SECRETS.some((s) => JSON.stringify(board).includes(s)));
  const slots = (await vol3.c.req("GET", "/api/volunteer")).json;
  check("volunteer view lists no slot that is already full", !(slots.slots as any[]).some((s) => s.pickupId === pickupId));

  // ---- the address only appears inside the allowed window ---------------------------------------------------------------
  const early = await vol1.c.details(pickupId);
  check("five days ahead, the assigned volunteer cannot see the address", early.status === 403 && codeOf(early) === "not_yet_visible" && !SECRETS.some((s) => early.text.includes(s)), early.text.slice(0, 200));
  check("...and is told when it will appear", typeof early.json.error?.details?.visibleFrom === "string");
  check("five days ahead, the coordinator cannot see it either", (await lonCoord.c.details(pickupId)).status === 403);
  const volPage = await vol1.c.req("GET", "/volunteer");
  check("the volunteer page (HTML) does not contain the address", volPage.status === 200 && !SECRETS.some((s) => volPage.text.includes(s)));
  const mineVol = (await vol1.c.req("GET", "/api/volunteer")).json;
  check("volunteer API shows the pickup, the partner and that the address is not visible yet", mineVol.assignments[0]?.addressVisibleNow === false && mineVol.assignments[0].partners.length === 1, JSON.stringify(mineVol.assignments));

  moveWindow(pickupId, 180); // window starts in 3 hours: inside 24 hours before
  const vis = await vol1.c.details(pickupId);
  check("within 24 hours of the window the assigned volunteer sees the address", vis.status === 200 && vis.json.details.address === ADDRESS && vis.json.details.phone === PHONE, String(vis.status));
  check("...and so does the coordinator", (await lonCoord.c.details(pickupId)).json.details?.address === ADDRESS);
  check("...but an unassigned volunteer, a stranger and the Oshawa coordinator still do not", (await vol3.c.details(pickupId)).status === 404 && (await stranger.c.details(pickupId)).status === 404 && (await oshCoord.c.details(pickupId)).status === 404);
  const audit = (await lonCoord.c.req("GET", "/api/chapters/london/audit?action=address_viewed&limit=50")).json.events as any[];
  const viewers = new Set(audit.filter((e) => e.subjectId === pickupId).map((e) => e.actorName));
  check("every address view is in the audit log (donor, volunteer, coordinator)", ["E2E Donor", "E2E Volunteer One", "E2E London Coordinator"].every((n) => viewers.has(n)), JSON.stringify([...viewers]));
  check("the audit log never contains the address", !SECRETS.some((s) => JSON.stringify(audit).includes(s)));
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
  check("volunteer one taps Done: the pledge waits for the pair", d1.status === 200 && d1.json.closedAs === null && (await donor.c.req("GET", `/api/pledges/${pledgeId}`)).json.pledge.status === "scheduled", JSON.stringify(d1.json));
  const d2 = await vol2.c.req("POST", `/api/pickups/${pickupId}/complete`, { outcome: "collected" });
  check("volunteer two taps Done: the pledge is collected", d2.status === 200 && d2.json.closedAs === "collected" && (await donor.c.req("GET", `/api/pledges/${pledgeId}`)).json.pledge.status === "collected", JSON.stringify(d2.json));
  const after = await vol1.c.details(pickupId);
  check("once the pickup is closed volunteers and coordinators no longer see the address", after.status === 403 && (await lonCoord.c.details(pickupId)).status === 403);
  check("the donor still sees their own details until the purge", (await donor.c.details(pickupId)).json.details?.address === ADDRESS);

  // ---- received into stock ------------------------------------------------------------------------------------------------
  const receiving = (await lonCoord.c.req("GET", "/api/chapters/london/receiving")).json.pledges as any[];
  const toCount = receiving.find((p) => p.pledgeId === pledgeId);
  check("the collected pickup is waiting to be counted", !!toCount && toCount.lines.length === 1);
  check("an Oshawa coordinator cannot count London's pledge", [403, 404].includes((await oshCoord.c.req("POST", `/api/pledges/${pledgeId}/receive`, { lines: [{ lineId: toCount.lines[0].lineId, quantity: 4 }] })).status));
  check("counting needs a number for every pledged line", (await lonCoord.c.req("POST", `/api/pledges/${pledgeId}/receive`, { lines: [] })).status === 422);
  const stockBefore = ((await lonCoord.c.req("GET", "/api/chapters/london/inventory")).json.inventory as any[]);
  const sBefore = (slug: string, name: string) => stockBefore.find((r) => r.name === name)?.stock ?? 0;
  const received = await lonCoord.c.req("POST", `/api/pledges/${pledgeId}/receive`, { lines: [{ lineId: toCount.lines[0].lineId, quantity: 3 }], extras: [{ itemId: item("gloves"), quantity: 2 }], note: "E2E: one pair was damaged" });
  check("the coordinator counts 3 of the 4 pledged socks plus 2 unpledged gloves into stock", received.status === 200 && received.json.received === 5, JSON.stringify(received.json));
  const stockAfter = ((await lonCoord.c.req("GET", "/api/chapters/london/inventory")).json.inventory as any[]);
  const sAfter = (name: string) => stockAfter.find((r) => r.name === name)?.stock ?? 0;
  check("stock went up by what was counted", sAfter("Socks") === sBefore("socks", "Socks") + 3 && sAfter("Gloves or mittens") === sBefore("gloves", "Gloves or mittens") + 2, `${sBefore("socks", "Socks")}->${sAfter("Socks")}`);
  check("the donor sees received quantities", ((await donor.c.req("GET", `/api/pledges/${pledgeId}`)).json.pledge.items as any[]).some((l) => l.receivedQuantity === 3));
  const line2 = ((await guest.req("GET", "/api/chapters/london")).json.board as any[]).find((l) => l.needId === needId);
  check("the public board shows 3 received and the remainder open again", line2.received === 3 && line2.pledged === 0 && line2.remaining === 9, JSON.stringify(line2));
  check("receiving twice is refused", (await lonCoord.c.req("POST", `/api/pledges/${pledgeId}/receive`, { lines: [{ lineId: toCount.lines[0].lineId, quantity: 3 }] })).status === 409);
  check("the inventory ledger records the receipt", ((await lonCoord.c.req("GET", "/api/chapters/london/inventory")).json.ledger as any[]).some((l) => l.kind === "received" && l.delta === 3));
  check("a negative stock change is refused", codeOf(await lonCoord.c.req("POST", "/api/chapters/london/inventory", { kind: "discarded", itemId: item("socks"), quantity: 10000, note: "too many" })) === "insufficient_stock");

  // ---- assemble and hand off a package -----------------------------------------------------------------------------------
  const tpl = await lonCoord.c.req("POST", "/api/chapters/london/templates", { name: `E2E kit ${stamp}`, weeklyTarget: 3, items: [{ itemId: item("socks"), quantity: 1 }, { itemId: item("gloves"), quantity: 1 }] });
  check("a coordinator creates a package template", tpl.status === 200 && tpl.json.template?.id, JSON.stringify(tpl.json));
  const pk0 = (await lonCoord.c.req("GET", "/api/chapters/london/packages")).json;
  const mine0 = (pk0.assemblable as any[]).find((a) => a.templateId === tpl.json.template.id);
  check("the dashboard shows the template can be assembled from current stock", mine0.maxPackages >= 1, JSON.stringify(mine0));
  const tooMany = await lonCoord.c.req("POST", "/api/chapters/london/packages", { templateId: tpl.json.template.id, count: 50 });
  check("assembling more than stock allows is refused and changes nothing", tooMany.status === 409 && codeOf(tooMany) === "insufficient_stock" && sAfter("Socks") === ((await lonCoord.c.req("GET", "/api/chapters/london/inventory")).json.inventory as any[]).find((r) => r.name === "Socks").stock);
  const asm = await lonCoord.c.req("POST", "/api/chapters/london/packages", { templateId: tpl.json.template.id, count: 1 });
  check("a package is assembled (stock drops in the same step)", asm.status === 200 && asm.json.packageIds?.length === 1, JSON.stringify(asm.json));
  check("assembly decremented the stock", ((await lonCoord.c.req("GET", "/api/chapters/london/inventory")).json.inventory as any[]).find((r) => r.name === "Socks").stock === sAfter("Socks") - 1);
  check("an Oshawa coordinator cannot hand off a London package", (await oshCoord.c.req("POST", "/api/chapters/london/packages/handoff", { packageIds: asm.json.packageIds, agencyId: partner.json.partner.id, date: localDate(0) })).status === 403);
  check("a hand-off cannot carry anything about the recipient", (await lonCoord.c.req("POST", "/api/chapters/london/packages/handoff", { packageIds: asm.json.packageIds, agencyId: partner.json.partner.id, date: localDate(0), recipientName: "A. Person" })).status === 422);
  const ho = await lonCoord.c.req("POST", "/api/chapters/london/packages/handoff", { packageIds: asm.json.packageIds, agencyId: partner.json.partner.id, date: localDate(0) });
  check("the package is handed off to the partner agency", ho.status === 200 && ho.json.handedOff === 1, JSON.stringify(ho.json));
  check("handing it off again is refused", (await lonCoord.c.req("POST", "/api/chapters/london/packages/handoff", { packageIds: asm.json.packageIds, agencyId: partner.json.partner.id, date: localDate(0) })).status === 409);

  // ---- impact -------------------------------------------------------------------------------------------------------------
  const impact1 = ((await guest.req("GET", "/api/impact")).json.chapters as any[]).find((c) => c.slug === "london");
  check("the public impact page counts the new package and the items received", impact1.packagesHandedOff === londonImpact0.packagesHandedOff + 1 && impact1.itemsReceived === londonImpact0.itemsReceived + 5, `${londonImpact0.packagesHandedOff}/${londonImpact0.itemsReceived} -> ${impact1.packagesHandedOff}/${impact1.itemsReceived}`);
  check("this week's bar went up", impact1.weekly.at(-1).packages >= 1);
  check("impact numbers are counts only (no names, ids or people)", !/E2E|@example/.test(JSON.stringify(impact1)));
  const impactPage = await guest.req("GET", "/impact");
  check("the impact page renders", impactPage.status === 200 && impactPage.text.includes("Packages handed off per week"));

  // ---- the address is purged ----------------------------------------------------------------------------------------------
  const raw = () => [process.env.DATABASE_PATH!, process.env.DATABASE_PATH + "-wal"].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f).toString("latin1")).join("");
  check("the address, notes and phone are not stored in plaintext anywhere in the database files", !SECRETS.some((s) => raw().includes(s)));
  const row = () => getDb().prepare("SELECT address_enc, notes_enc, phone_enc, purged_at FROM pickup WHERE id = ?").get(pickupId) as Record<string, string | null>;
  check("before the purge the encrypted details are stored", !!row().address_enc && row().address_enc !== ADDRESS && !!row().notes_enc && !!row().phone_enc);
  check("the purge job does nothing before 7 days", purgePickups() >= 0 && !!row().address_enc);
  getDb().prepare("UPDATE pledge SET closed_at = ? WHERE id = ?").run(new Date(Date.now() - 8 * 86400_000).toISOString(), pledgeId); // stands in for 8 days passing
  const purged = purgePickups();
  check("the purge job erases it 7+ days after the pickup closed", purged >= 1 && row().address_enc === null && row().notes_enc === null && row().phone_enc === null && !!row().purged_at, JSON.stringify(row()));
  const gone = await donor.c.details(pickupId);
  check("the donor is told the details were erased", gone.status === 410 && codeOf(gone) === "details_purged", String(gone.status));
  check("My pledges says the details were erased", ((await donor.c.req("GET", `/api/pledges/${pledgeId}`)).json.pledge.pickup.detailsPurged) === true);

  // ---- cross-chapter and leakage checks --------------------------------------------------------------------------------------
  for (const path of ["pickups", "inventory", "receiving", "dropoffs", "members", "audit", "templates", "zones", "partners", "reports", "needs", "packages"]) {
    const r = await oshCoord.c.req("GET", `/api/chapters/london/${path}`);
    check(`Oshawa coordinator is refused London's ${path}`, r.status === 403, String(r.status));
  }
  for (const path of ["pickups", "inventory", "members", "audit"]) {
    check(`London coordinator is refused Oshawa's ${path}`, (await lonCoord.c.req("GET", `/api/chapters/oshawa/${path}`)).status === 403);
  }
  check("an Oshawa coordinator cannot post a need in London", (await oshCoord.c.req("POST", "/api/chapters/london/needs", { itemId: item("scarf"), quantity: 5 })).status === 403);
  check("a plain member cannot use the coordinator API", (await stranger.c.req("GET", "/api/chapters/london/pickups")).status === 403 && (await stranger.c.req("POST", "/api/chapters/london/needs", { itemId: item("scarf"), quantity: 5 })).status === 403);
  const html = await Promise.all([donor.c, vol1.c, lonCoord.c, admin.c].map((c) => c.req("GET", "/pledges")));
  const coordPages = await Promise.all(["pickups", "reports", "audit", "receive", "dropoffs"].map((t) => lonCoord.c.req("GET", `/coordinate/london?tab=${t}`)));
  check("no server-rendered page contains the address", [...html, ...coordPages].every((r) => !SECRETS.some((s) => r.text.includes(s))));
  const leaked = transcript.filter((t) => !t.allowSecret && SECRETS.some((s) => t.text.includes(s)));
  check(`the address appears in no response except the audited pickup-details endpoint (${transcript.length} responses checked)`, leaked.length === 0, leaked.map((l) => `${l.who} ${l.method} ${l.path}`).join("; "));
  const allowed = transcript.filter((t) => t.allowSecret && t.status === 200 && SECRETS.some((s) => t.text.includes(s)));
  check("and only the donor, the assigned volunteer and the coordinator ever got it from that endpoint", allowed.every((t) => ["E2E Donor", "E2E Volunteer One", "E2E London Coordinator"].includes(t.who)), [...new Set(allowed.map((a) => a.who))].join(", "));

  // ---- request guard, origin and upload probes -------------------------------------------------------------------------------
  const cross = await donor.c.req("POST", "/api/pledges", pledgeBody(), { headers: { Origin: "https://evil.example" } });
  check("a cross-origin pledge is rejected", cross.status === 403, String(cross.status));
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "photo.pdf");
  const up = await fetch(BASE + "/api/pledges", { method: "POST", headers: { Origin: BASE, Cookie: donor.c.cookie }, body: form });
  check("file uploads are rejected (nothing about recipients can be attached)", up.status === 415, String(up.status));
  check("oversized bodies are rejected", (await fetch(BASE + "/api/pledges", { method: "POST", headers: { Origin: BASE, "Content-Type": "application/json", Cookie: donor.c.cookie }, body: JSON.stringify({ x: "y".repeat(120_000) }) })).status === 413);

  // ---- account deletion ---------------------------------------------------------------------------------------------------------
  const p2 = await donor2.c.req("POST", "/api/pledges", pledgeBody({ items: [{ needId, quantity: 2 }], address: "9 Delete Me Lane" }));
  const p2Pickup = ((await donor2.c.req("GET", "/api/pledges")).json.pledges as any[])[0].pickup.id as string;
  const del = await donor2.c.req("DELETE", "/api/account", { confirm: "DELETE" });
  const p2row = getDb().prepare("SELECT p.status, p.donor_id, k.address_enc FROM pledge p JOIN pickup k ON k.pledge_id = p.id WHERE p.id = ?").get(p2.json.id) as any;
  check("deleting an account cancels open pledges, erases pickup details at once and detaches the donor", del.status === 200 && p2row.status === "cancelled" && p2row.address_enc === null && p2row.donor_id === null, JSON.stringify(p2row));
  check("the deleted donor's session no longer works", (await donor2.c.req("GET", "/api/pledges")).status === 401 && !!p2Pickup);

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
