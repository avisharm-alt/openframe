// Browser walkthrough + automated accessibility scan (axe-core) against a RUNNING demo server.
//   BASE_URL=http://localhost:3100 tsx scripts/browser-check.ts [screenshotDir]
// Drives the main flows with the KEYBOARD ONLY (guest, donor, volunteer, coordinator) at 1100px and 375px, runs axe
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
  log((await page.getByRole("heading", { level: 1 }).innerText()).includes("Care packages"), `[${label}] home leads with the purpose`);
  log(await page.getByRole("heading", { name: /What we need right now in London/ }).isVisible(), `[${label}] home shows London's live needs board`);
  log((await page.locator(".need-list > li").count()) > 0 && (await page.locator(".meter").count()) > 0, `[${label}] board lists needs with progress bars`);
  const firstMeter = await page.locator(".meter").first().getAttribute("aria-label");
  log(/\d+ of \d+ received, \d+ more pledged/.test(firstMeter ?? ""), `[${label}] progress is available as text (“${firstMeter}”)`);
  log((await page.getByText("What we can’t accept").count()) > 0 && (await page.getByText(/Medication of any kind/).count()) > 0, `[${label}] the new-items-only rules are on the page`);
  await axe(page, `[${label}] home (London)`);
  await shot(page, `${label}-home`);
  if (width <= 480) log(!(await overflow(page)), `[${label}] no horizontal page scroll: home`);

  // Keyboard: skip link, then the chapter picker.
  await page.keyboard.press("Tab");
  log((await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("Skip to main content"), `[${label}] first Tab stop is the skip link`);
  await page.getByRole("link", { name: /Oshawa/ }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/chapter=oshawa/);
  log(await page.getByRole("heading", { name: /What we need right now in Oshawa/ }).isVisible(), `[${label}] keyboard picks the Oshawa chapter and its own board`);
  await axe(page, `[${label}] home (Oshawa)`);
  await shot(page, `${label}-home-oshawa`);

  await page.getByRole("link", { name: "Pledge items" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/auth\/sign-in\?next=/);
  log(true, `[${label}] pledging sends a guest to sign in and remembers where they were going`);

  for (const p of ["/impact", "/about", "/guidelines", "/safety", "/privacy", "/auth/sign-in"]) await visit(c, p);
  const bars = await (async () => { await page.goto(BASE + "/impact"); return page.locator(".bars li").count(); })();
  log(bars >= 12, `[${label}] impact page shows weekly counts (${bars} rows)`);
  await page.goto(BASE + "/safety");
  const rules = await page.locator("ol > li").count();
  log(rules >= 8 && (await page.getByText(/Always in pairs/).count()) > 0 && (await page.getByText(/Doorstep handoff/).count()) > 0, `[${label}] Safety page lists the volunteer rules (pairs, daytime, doorstep, emergency contact, reporting)`);
  log(c.errors.length === 0, `[${label}] guest: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();
}

async function donorFlow(browser: Browser, width: number, height: number, label: string, email: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await signIn(c, email, "/pledge?chapter=london");
  await page.waitForURL(/\/pledge/);
  await page.getByRole("heading", { name: /Pledge items to London/ }).waitFor();
  log(true, `[${label}] keyboard sign-in returns to the pledge form`);
  log((await page.getByText(/Yes, please/).count()) > 0 && (await page.getByText(/Medication of any kind/).count()) > 0, `[${label}] accepted / not-accepted rules are shown inline on the pledge form`);
  await axe(page, `[${label}] pledge form (drop-off)`);
  await shot(page, `${label}-pledge`);
  // Pickup variant: safety wording and private-address fields.
  await page.getByRole("radio", { name: /Pickup from my address/ }).focus();
  await page.keyboard.press("Space");
  log(await page.getByLabel(/Pickup address/).isVisible() && (await page.getByText(/two volunteers come together/i).count()) > 0, `[${label}] choosing pickup shows the address field and the safety promise`);
  await axe(page, `[${label}] pledge form (pickup)`);
  if (width <= 480) log(!(await overflow(page)), `[${label}] no horizontal page scroll: pledge form`);
  await shot(page, `${label}-pledge-pickup`);
  // Back to drop-off, fill it with the keyboard and submit.
  await page.getByRole("radio", { name: /Drop off at a public zone/ }).focus();
  await page.keyboard.press("Space");
  await page.locator('input[type="number"]').first().focus();
  await page.keyboard.type("2");
  const date = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  await page.getByLabel("Expected date").fill(date);
  await page.getByRole("button", { name: "Confirm pledge" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/pledges\?new=1/);
  await page.getByRole("heading", { name: "My pledges" }).waitFor();
  log((await page.getByText(/Drop-off/).count()) > 0 && (await page.getByText(/Pledged/).count()) > 0, `[${label}] the pledge is created with the keyboard and listed as pledged`);
  await axe(page, `[${label}] my pledges (new)`);
  await shot(page, `${label}-my-pledges`);
  log(c.errors.length === 0, `[${label}] donor: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();
}

async function donorWithPickups(browser: Browser, width: number, height: number, label: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await signIn(c, "demo-donor-3@example.test", "/pledges");
  await page.getByRole("heading", { name: "My pledges" }).waitFor();
  log((await page.getByText("Scheduled").count()) > 0 && (await page.getByText("No-show").count()) > 0, `[${label}] a donor sees pledges in several states`);
  await axe(page, `[${label}] my pledges (several states)`);
  if (width <= 480) log(!(await overflow(page)), `[${label}] no horizontal page scroll: my pledges`);
  // Reveal own pickup details with the keyboard: hidden until asked.
  log((await page.getByText(/Demo Street/).count()) === 0, `[${label}] address is not in the page until the donor asks`);
  await page.getByRole("button", { name: "Show my pickup details" }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByText(/Demo Street/).first().waitFor();
  log(true, `[${label}] keyboard reveals the donor's own address`);
  await axe(page, `[${label}] my pledges (details shown)`);
  await page.getByRole("button", { name: "Reschedule" }).first().focus();
  await page.keyboard.press("Enter");
  await axe(page, `[${label}] my pledges (reschedule open)`);
  await shot(page, `${label}-pledges-states`);
  log(c.errors.length === 0, `[${label}] donor pledges: no console/page errors${c.errors.length ? ": " + c.errors.slice(0, 3).join(" | ") : ""}`);
  await c.close();
}

async function volunteerFlow(browser: Browser, width: number, height: number, label: string) {
  const c = await newCtx(browser, width, height, label);
  const { page } = c;
  await signIn(c, "demo-london-volunteer-1@example.test", "/volunteer");
  await page.getByRole("heading", { name: "My pickups" }).waitFor();
  log((await page.getByText("Upcoming").count()) > 0 && (await page.locator(".vcard").count()) >= 2, `[${label}] volunteer sees upcoming pickups`);
  const html = await page.content();
  log(!/Demo Street/.test(html), `[${label}] no address is in the volunteer page until it is revealed`);
  log((await page.getByText(/The address appears here from|shown once the pickup is scheduled/).count()) > 0, `[${label}] a pickup outside the window explains when its address will appear`);
  log((await page.getByText(/Available slots/).count()) > 0, `[${label}] available slots are listed`);
  await axe(page, `[${label}] volunteer view`);
  if (width <= 480) {
    log(!(await overflow(page)), `[${label}] no horizontal page scroll: volunteer view`);
    const small = await page.locator(".vcard .btn").evaluateAll((els) => els.filter((e) => (e as HTMLElement).getBoundingClientRect().height < 40).length);
    log(small === 0, `[${label}] volunteer buttons are large enough to tap (${small} smaller than 40px)`);
  }
  // The pickup whose window is today: reveal the address with the keyboard, then check-in controls.
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
  await c2.page.getByRole("heading", { name: "My pickups" }).waitFor();
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
  for (const tab of ["needs", "templates", "dropoffs", "pickups", "receive", "inventory", "packages", "people", "zones", "partners", "reports", "audit"]) {
    await visit(c, `/coordinate/london?tab=${tab}`, `coordinator dashboard: ${tab}`);
  }
  await page.goto(`${BASE}/coordinate/london?tab=pickups`);
  const counts = await Promise.all(["Overdue", "Today", "Unassigned", "Scheduled"].map(async (h) => (await page.getByRole("heading", { name: new RegExp(`^${h}`) }).count()) > 0));
  log(counts.every(Boolean), `[${label}] pickup board has unassigned / scheduled / today / overdue sections`);
  log((await page.getByText("Overdue", { exact: true }).count()) > 0, `[${label}] an overdue pickup is flagged`);
  log(!/Demo Street/.test(await page.content()), `[${label}] pickup board never includes an address`);
  await shot(page, `${label}-coordinator-pickups`);
  await page.goto(`${BASE}/coordinate/london?tab=packages`);
  log((await page.getByText(/can assemble \d+ now|cannot be assembled yet/).count()) > 0, `[${label}] packages tab shows which templates can be assembled`);
  await shot(page, `${label}-coordinator-packages`);
  // Cross-chapter: the London coordinator gets nothing for Oshawa.
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
  for (const p of ["/?chapter=london", "/impact", "/safety", "/pledge?chapter=london", "/auth/sign-in"]) await visit(c, p);
  await signIn(c, "demo-london-volunteer-1@example.test", "/volunteer");
  await visit(c, "/volunteer", "volunteer");
  await c.page.getByRole("button", { name: "Show address" }).first().click();
  await axe(c.page, "[dark] volunteer view (address shown)");
  await c.close();
  const k = await newCtx(browser, 1100, 900, "dark", "dark");
  await signIn(k, "demo-london-coordinator@example.test", "/coordinate/london?tab=pickups");
  for (const tab of ["pickups", "packages", "needs"]) await visit(k, `/coordinate/london?tab=${tab}`, `coordinator ${tab}`);
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
    await donorFlow(browser, w, h, label, `demo-new-donor@example.test`);
    await donorWithPickups(browser, w, h, label);
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
