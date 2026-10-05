// Browser walkthrough + automated accessibility scan (axe-core) against a RUNNING demo server.
//   BASE_URL=http://localhost:3100 tsx scripts/browser-check.ts [screenshotDir]
// Drives the main flows with the KEYBOARD ONLY (guest, neighbour, agency worker, volunteer, coordinator) at 1100px and 375px, runs axe
// (WCAG 2.0/2.1/2.2 A and AA tags) on every page and state it visits, and checks for horizontal page scroll.
// It relies on the accounts created by `npm run db:seed-demo`.
import { chromium, type Browser, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const SHOTS = process.argv[2];
const exe = process.env.CHROMIUM_PATH || ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => fs.existsSync(p));
const PASSWORD = "demo-password-123";
let failures = 0;
let checks = 0;
const log = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
};

async function axe(page: Page, name: string) {
  // Next streams the <title> in after the page body, so wait for it before scanning.
  await page.waitForFunction(() => document.title.length > 0);
  await page.addScriptTag({ path: require.resolve("axe-core") });
  const res = await page.evaluate(async () => {
    // @ts-expect-error injected global
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")) }));
  });
  log(res.length === 0, `axe (WCAG 2.2 AA tags): ${name}${res.length ? " -> " + JSON.stringify(res) : ""}`);
}
const shot = async (page: Page, n: string) => {
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true });
  }
};
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

type Ctx = { page: Page; label: string; width: number; errors: string[] };
async function newCtx(browser: Browser, width: number, height: number, label: string, scheme: "light" | "dark" = "light"): Promise<Ctx & { close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width, height }, bypassCSP: true, colorScheme: scheme });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { page, label, width, errors, close: () => context.close() };
}

/** Opens a page, scans it with axe and (on narrow screens) checks there is no horizontal page scroll. */
async function visit(c: Ctx, p: string, name = p) {
  await c.page.goto(BASE + p);
  await c.page.locator("main").waitFor();
  await axe(c.page, `[${c.label}] ${name}`);
  if (c.width <= 480) log(!(await overflow(c.page)), `[${c.label}] no horizontal page scroll: ${name}`);
}

/** Keyboard-only sign-in with a demo account. */
async function signIn(c: Ctx, email: string, next = "/") {
  const { page } = c;
  await page.goto(`${BASE}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator("#email").focus();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/sign-in"));
}

async function guestFlow(browser: Browser, width: number, height: number, label: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await page.goto(BASE + "/?chapter=london"); // the walkthrough adds a Kingston chapter that sorts first, so ask for London
  log((await page.getByRole("heading", { level: 1 }).innerText()).includes("Specific things"), `[${label}] home leads with the purpose`);
  log(await page.getByRole("heading", { name: /Requests in London/ }).isVisible(), `[${label}] home shows London's live request board`);
  log((await page.locator(".need-list > li.req").count()) > 0, `[${label}] board lists request cards`);
  log((await page.locator(".need-list .badge.urgent").count()) > 0, `[${label}] urgent requests carry a badge`);
  log((await page.locator(".need-list > li.restock").count()) > 0 && (await page.getByText("Student team restock").count()) > 0, `[${label}] restock requests are visually distinct and labelled`);
  const first = await page.locator(".need-list > li.req").first().innerText();
  log(/needed by/.test(first) && /For .+, delivered to/.test(first), `[${label}] a card shows item, quantity, needed-by, partner and delivery site`);
  log((await page.getByText("What we can’t accept").count()) > 0 && (await page.getByText(/Medication of any kind/).count()) > 0, `[${label}] the new-items-only rules are on the page`);
  await axe(page, `[${label}] home (London)`);
  await shot(page, `${label}-home`);
  if (width <= 480) log(!(await overflow(page)), `[${label}] no horizontal page scroll: home`);

  // Keyboard: skip link, then filter the board, then the chapter picker.
  await page.keyboard.press("Tab");
  log((await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("Skip to main content"), `[${label}] first Tab stop is the skip link`);
  await page.locator("#f-category").focus();
  await page.keyboard.type("Footwear");
  await page.locator("#f-category").evaluate((el) => (el as HTMLSelectElement).form!.querySelector<HTMLButtonElement>("button")!.focus());
  await page.keyboard.press("Enter");
  await page.waitForURL(/category=footwear/);
  const filtered = await page.locator(".need-list > li.req").allInnerTexts();
  log(filtered.length > 0 && filtered.every((t) => /boots|shoes|sneakers/i.test(t)), `[${label}] keyboard filter by category shows only footwear (${filtered.length})`);
  await axe(page, `[${label}] home (filtered)`);
  await page.goto(BASE + "/?chapter=london");
  await page.getByRole("link", { name: /Oshawa/ }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/chapter=oshawa/);
  log(await page.getByRole("heading", { name: /Requests in Oshawa/ }).isVisible(), `[${label}] keyboard picks the Oshawa chapter and its own board`);
  await axe(page, `[${label}] home (Oshawa)`);
  await shot(page, `${label}-home-oshawa`);

  await page.getByRole("link", { name: "Claim this" }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/auth\/sign-in\?next=/);
  log(true, `[${label}] claiming sends a guest to sign in and remembers where they were going`);

  for (const p of ["/impact", "/about", "/guidelines", "/safety", "/privacy", "/partner", "/auth/sign-in"]) await visit(c, p);
  await page.goto(BASE + "/impact");
  const median = await page.getByRole("heading", { name: /Median time from request to delivery/ }).count();
  log(median > 0, `[${label}] impact page leads with the median time from request to delivery`);
  log((await page.locator(".bars li").count()) >= 12, `[${label}] impact page shows weekly counts per chapter`);
  await page.goto(BASE + "/safety");
  const rules = await page.locator("ol > li").count();
  log(rules >= 8 && (await page.getByText(/Always in pairs/).count()) > 0 && (await page.getByText(/Never interact with recipients/).count()) > 0, `[${label}] Safety page lists the volunteer rules (pairs, daytime, doorstep, no recipient contact, reporting)`);
  log(c.errors.length === 0, `[${label}] guest: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();
}

async function neighbourFlow(browser: Browser, width: number, height: number, label: string, email: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await page.goto(BASE + "/?chapter=london");
  const href = await page.locator(".need-list > li.req:not(.restock) a.btn").first().getAttribute("href");
  await signIn(c, email, href!);
  await page.getByRole("heading", { name: "Claim a request" }).waitFor();
  log(true, `[${label}] keyboard sign-in returns to the claim form`);
  log((await page.getByText(/Yes, please/).count()) > 0 && (await page.getByText(/Medication of any kind/).count()) > 0, `[${label}] accepted / not-accepted rules are shown inline on the claim form`);
  await axe(page, `[${label}] claim form (drop-off)`);
  await shot(page, `${label}-claim`);
  await page.getByRole("radio", { name: /Pickup from my address/ }).focus();
  await page.keyboard.press("Space");
  log(await page.getByLabel(/Pickup address/).isVisible() && (await page.getByText(/two volunteers come together/i).count()) > 0, `[${label}] choosing pickup shows the address field and the safety promise`);
  log((await page.getByText(/scheduled within 48 hours/).count()) > 0, `[${label}] the 48-hour release rule is explained before claiming`);
  await axe(page, `[${label}] claim form (pickup)`);
  if (width <= 480) log(!(await overflow(page)), `[${label}] no horizontal page scroll: claim form`);
  await shot(page, `${label}-claim-pickup`);
  await page.getByRole("radio", { name: /Drop off at a public zone/ }).focus();
  await page.keyboard.press("Space");
  const date = new Date(Date.now() + 1 * 86400_000).toISOString().slice(0, 10);
  await page.getByLabel(/Drop-off date/).fill(date);
  await page.getByRole("button", { name: "Confirm claim" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/claims\?new=1/);
  await page.getByRole("heading", { name: "My claims" }).waitFor();
  log((await page.getByText(/Drop-off/).count()) > 0 && (await page.getByText(/Claimed|Scheduled/).count()) > 0, `[${label}] the claim is created with the keyboard and listed in My claims`);
  await axe(page, `[${label}] my claims (new)`);
  await shot(page, `${label}-my-claims`);
  log(c.errors.length === 0, `[${label}] neighbour: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();
}

async function neighbourWithClaims(browser: Browser, width: number, height: number, label: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await signIn(c, "demo-neighbour-3@example.test", "/claims");
  await page.getByRole("heading", { name: "My claims" }).waitFor();
  log((await page.getByText("Scheduled").count()) > 0 && (await page.getByText("No-show").count()) > 0, `[${label}] a neighbour sees claims in several states`);
  await axe(page, `[${label}] my claims (several states)`);
  if (width <= 480) log(!(await overflow(page)), `[${label}] no horizontal page scroll: my claims`);
  log((await page.getByText(/Demo Street/).count()) === 0, `[${label}] address is not in the page until the neighbour asks`);
  await page.getByRole("button", { name: "Show my pickup details" }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Demo Street/).first().waitFor();
  log(true, `[${label}] keyboard reveals the neighbour's own address`);
  await axe(page, `[${label}] my claims (details shown)`);
  await page.getByRole("button", { name: "Reschedule" }).first().focus();
  await page.keyboard.press("Enter");
  await axe(page, `[${label}] my claims (reschedule open)`);
  await shot(page, `${label}-claims-states`);
  await c.close();

  const d = await newCtx(browser, width, height, label);
  await signIn(d, "demo-neighbour-2@example.test", "/claims");
  await d.page.getByRole("heading", { name: "My claims" }).waitFor();
  log((await d.page.getByText(/Delivered to Ark Aid Street Mission \(demo\)/).count()) > 0, `[${label}] a delivered claim says “Delivered to [partner] on [date]”`);
  await axe(d.page, `[${label}] my claims (delivered)`);
  log(d.errors.length === 0 && c.errors.length === 0, `[${label}] neighbour claims: no console/page errors`);
  await d.close();
}

async function workerFlow(browser: Browser, width: number, height: number, label: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await signIn(c, "demo-london-worker@example.test", "/partner");
  await page.getByRole("heading", { name: /Ark Aid Street Mission/ }).waitFor();
  log(await page.getByRole("heading", { name: "Post a request" }).isVisible(), `[${label}] an agency worker lands on their partner's page`);
  log((await page.getByRole("button", { name: "Repeat my last request" }).count()) > 0 && (await page.getByText(/Winter boots|winter boots/).count()) > 0, `[${label}] repeat-last-request and favourites are one tap away`);
  log((await page.getByText(/Describe the item, never the person/).count()) > 0, `[${label}] the form warns against identifying anyone`);
  await axe(page, `[${label}] partner portal`);
  if (width <= 480) {
    log(!(await overflow(page)), `[${label}] no horizontal page scroll: partner portal`);
    const small = await page.locator("form .btn, .quick .btn").evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().height < 36).length);
    log(small === 0, `[${label}] partner buttons are large enough to tap (${small} smaller than 36px)`);
  }
  // Post a request with the keyboard only.
  await page.locator("#r-item").focus();
  await page.keyboard.type("Sweatshirt");
  await page.locator("#r-size").focus();
  await page.keyboard.type("M");
  await page.locator("#r-qty").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("3");
  await page.getByRole("button", { name: "In 3 days" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Post request" }).focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Request posted|posted/i).first().waitFor();
  log(true, `[${label}] a request is posted with the keyboard in a few keystrokes`);
  await axe(page, `[${label}] partner portal (after posting)`);
  await shot(page, `${label}-partner`);
  if (label === "desktop") { // the demo data has one delivered request waiting for confirmation, so only confirm it once
    const confirmBtn = page.getByRole("button", { name: "Confirm we received it" }).first();
    log((await confirmBtn.count()) > 0, `[${label}] a delivered request offers “Confirm we received it”`);
    await confirmBtn.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.body.innerText.includes("Working…"));
    log(true, `[${label}] keyboard confirms receipt`);
  }
  log(c.errors.length === 0, `[${label}] worker: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();

  const p = await newCtx(browser, width, height, label);
  await signIn(p, "demo-pending-worker@example.test", "/partner");
  await p.page.getByRole("heading", { name: "For partners" }).waitFor();
  log((await p.page.getByText(/Waiting for a coordinator to approve/).count()) > 0 && (await p.page.getByRole("button", { name: "Post request" }).count()) === 0, `[${label}] a worker waiting for approval cannot post`);
  await axe(p.page, `[${label}] partner page (pending worker)`);
  await p.close();
}

async function volunteerFlow(browser: Browser, width: number, height: number, label: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await signIn(c, "demo-london-volunteer-1@example.test", "/volunteer");
  await page.getByRole("heading", { name: "My shifts and pickups" }).waitFor();
  log((await page.getByRole("heading", { name: "My shifts" }).count()) > 0 && (await page.getByText(/Tuesday evening run/).count()) > 0, `[${label}] volunteer sees their weekly shifts`);
  log((await page.locator(".vcard").count()) >= 2, `[${label}] volunteer sees pickups and a delivery run`);
  log((await page.getByRole("heading", { name: "My delivery runs" }).count()) > 0 && (await page.getByText(/Mon–Fri|Daily 10:00–14:00/).count()) > 0, `[${label}] the delivery batch shows the site's receiving hours`);
  log((await page.getByRole("button", { name: "Start delivery" }).count()) > 0, `[${label}] a planned delivery can be started`);
  const html = await page.content();
  log(!/Demo Street/.test(html), `[${label}] no address is in the volunteer page until it is revealed`);
  log((await page.getByText(/The address appears here from|shown once the pickup is scheduled/).count()) > 0, `[${label}] a pickup outside the window explains when its address will appear`);
  await axe(page, `[${label}] volunteer view`);
  if (width <= 480) {
    log(!(await overflow(page)), `[${label}] no horizontal page scroll: volunteer view`);
    const small = await page.locator(".vcard .btn").evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().height < 40).length);
    log(small === 0, `[${label}] volunteer buttons are large enough to tap (${small} smaller than 40px)`);
  }
  const reveal = page.getByRole("button", { name: "Show address" }).first();
  log((await reveal.count()) > 0, `[${label}] the pickup within its window offers “Show address”`);
  await reveal.focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Demo Street/).first().waitFor();
  log(true, `[${label}] keyboard reveals the address inside the allowed window`);
  log((await page.getByText(/do not go inside/i).count()) > 0, `[${label}] the reveal reminds the volunteer: do not go inside`);
  log((await page.getByRole("button", { name: "Arrived" }).count()) > 0 && (await page.getByRole("button", { name: /Couldn.t complete/ }).count()) > 0, `[${label}] Arrived and Couldn't complete controls are present`);
  await axe(page, `[${label}] volunteer view (address shown)`);
  await shot(page, `${label}-volunteer`);
  await page.getByRole("button", { name: /Couldn.t complete/ }).first().focus();
  await page.keyboard.press("Enter");
  await axe(page, `[${label}] volunteer view (couldn't complete open)`);
  log(c.errors.length === 0, `[${label}] volunteer: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();

  const c2 = await newCtx(browser, width, height, label);
  await signIn(c2, "demo-new-volunteer@example.test", "/volunteer");
  await c2.page.getByRole("heading", { name: "My shifts and pickups" }).waitFor();
  log((await c2.page.getByText(/read and acknowledge the Safety rules/).count()) > 0, `[${label}] a volunteer who has not acknowledged the Safety rules is gated`);
  await axe(c2.page, `[${label}] volunteer view (safety gate)`);
  await c2.page.goto(BASE + "/safety");
  log((await c2.page.getByRole("button", { name: /I have read these rules/ }).count()) > 0, `[${label}] the Safety page offers the timestamped acknowledgement`);
  await axe(c2.page, `[${label}] safety page (volunteer)`);
  await c2.close();
}

async function coordinatorFlow(browser: Browser, width: number, height: number, label: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await signIn(c, "demo-london-coordinator@example.test", "/coordinate");
  await page.getByRole("heading", { name: /London/ }).first().waitFor();
  log(page.url().includes("/coordinate/london"), `[${label}] a coordinator of one chapter lands on their dashboard`);
  for (const tab of ["requests", "pickups", "dropoffs", "receive", "deliveries", "stock", "kits", "approvals", "partners", "people", "shifts", "zones", "reports", "audit"]) {
    await visit(c, `/coordinate/london?tab=${tab}`, `coordinator dashboard: ${tab}`);
  }
  await page.goto(`${BASE}/coordinate/london?tab=requests`);
  log((await page.getByRole("button", { name: /Fill from stock/ }).count()) > 0, `[${label}] open requests offer “Fill from stock”`);
  log((await page.locator(".card-sm.overdue").count()) > 0 && (await page.getByText(/At risk|Overdue by/).count()) > 0, `[${label}] requests at risk of missing their needed-by date are highlighted`);
  await shot(page, `${label}-coordinator-requests`);
  await page.goto(`${BASE}/coordinate/london?tab=pickups`);
  const counts = await Promise.all(["Overdue", "Today", "Unassigned", "Scheduled"].map(async (h) => (await page.getByRole("heading", { name: new RegExp(`^${h}`) }).count()) > 0));
  log(counts.every(Boolean), `[${label}] pickup board has unassigned / scheduled / today / overdue sections`);
  log(!/Demo Street/.test(await page.content()), `[${label}] pickup board never includes an address`);
  await shot(page, `${label}-coordinator-pickups`);
  await page.goto(`${BASE}/coordinate/london?tab=stock`);
  log((await page.getByText(/below target/).count()) > 0, `[${label}] stock tab shows items below their restock target`);
  await page.goto(`${BASE}/coordinate/london?tab=approvals`);
  log((await page.getByText("Demo Pending Worker").count()) > 0 && (await page.getByText(/Eastside Food Bank/).count()) > 0, `[${label}] approvals list the pending worker and the unverified partner`);
  await shot(page, `${label}-coordinator-approvals`);
  await page.goto(`${BASE}/coordinate/london?tab=shifts`);
  log((await page.getByText(/Needs \d+ more|Covered/).count()) > 0, `[${label}] shifts tab shows coverage gaps`);
  await page.goto(`${BASE}/coordinate/london?tab=kits`);
  log((await page.getByText(/assembled/).count()) > 0, `[${label}] kits tab shows kit templates and assembled kits`);
  await page.goto(`${BASE}/coordinate/oshawa`);
  log((await page.getByText(/not found|404/i).count()) > 0, `[${label}] a London coordinator cannot open Oshawa's dashboard`);
  log(c.errors.length === 0, `[${label}] coordinator: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();

  const a = await newCtx(browser, width, height, label);
  await signIn(a, "demo-admin@example.test", "/admin");
  await a.page.getByRole("heading", { name: "Admin" }).waitFor();
  await axe(a.page, `[${label}] admin`);
  await a.close();
}

async function darkPass(browser: Browser) {
  const c = await newCtx(browser, 1100, 900, "dark", "dark");
  for (const p of ["/?chapter=london", "/impact", "/safety", "/partner", "/auth/sign-in"]) await visit(c, p);
  await signIn(c, "demo-london-volunteer-1@example.test", "/volunteer");
  await visit(c, "/volunteer", "volunteer");
  await c.page.getByRole("button", { name: "Show address" }).first().click();
  await axe(c.page, "[dark] volunteer view (address shown)");
  await c.close();
  const w = await newCtx(browser, 1100, 900, "dark", "dark");
  await signIn(w, "demo-london-worker@example.test", "/partner");
  await visit(w, "/partner", "partner portal");
  await w.close();
  const n = await newCtx(browser, 1100, 900, "dark", "dark");
  await signIn(n, "demo-neighbour-3@example.test", "/claims");
  await visit(n, "/claims", "my claims");
  await n.close();
  const k = await newCtx(browser, 1100, 900, "dark", "dark");
  await signIn(k, "demo-london-coordinator@example.test", "/coordinate/london?tab=pickups");
  for (const tab of ["requests", "pickups", "stock", "approvals"]) await visit(k, `/coordinate/london?tab=${tab}`, `coordinator ${tab}`);
  await k.close();
}

async function prodStyleSignIn(browser: Browser) {
  const url = process.env.PROD_URL;
  if (!url) return;
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, bypassCSP: true, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(url + "/auth/sign-in");
    log(await page.getByRole("button", { name: "Continue with Google" }).isVisible(), `[prod-style ${scheme}] sign-in shows the Google button`);
    log((await page.locator('input[type="password"]').count()) === 0, `[prod-style ${scheme}] no password field`);
    await axe(page, `[prod-style ${scheme}] sign-in`);
    await shot(page, `signin-${scheme}`);
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  await prodStyleSignIn(browser);
  for (const [w, h, label] of [[1100, 900, "desktop"], [375, 760, "mobile"]] as const) {
    await guestFlow(browser, w, h, label);
    await neighbourFlow(browser, w, h, label, `demo-new-neighbour@example.test`);
    await neighbourWithClaims(browser, w, h, label);
    await workerFlow(browser, w, h, label);
    await volunteerFlow(browser, w, h, label);
    await coordinatorFlow(browser, w, h, label);
  }
  await darkPass(browser);
  await browser.close();
  console.log(failures ? `\n${failures} of ${checks} check(s) failed` : `\nAll ${checks} browser checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
