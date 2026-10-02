// Browser walkthrough + automated accessibility scan (axe-core) against a RUNNING demo server.
//   BASE_URL=http://localhost:3100 tsx scripts/browser-check.ts [screenshotDir]
// Drives a guest through practice using the KEYBOARD ONLY, at desktop and mobile widths.
import { chromium, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const SHOTS = process.argv[2];
const exe = process.env.CHROMIUM_PATH || ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => fs.existsSync(p));
let failures = 0;
const log = (ok: boolean, msg: string) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); };

async function axe(page: Page, name: string) {
  await page.addScriptTag({ path: require.resolve("axe-core") });
  const res = await page.evaluate(async () => {
    // @ts-expect-error injected global
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")) }));
  });
  log(res.length === 0, `axe (WCAG 2.2 AA tags): ${name}${res.length ? " -> " + JSON.stringify(res) : ""}`);
}
const shot = async (page: Page, n: string) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }); } };

async function guestFlow(width: number, height: number, label: string) {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width, height }, bypassCSP: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(BASE);
  log(await page.locator("#q").isVisible(), `[${label}] home page leads with course search`);
  await axe(page, `[${label}] home`);
  await shot(page, `${label}-home`);

  // Keyboard-only: tab to search, type, enter.
  await page.locator("#q").focus();
  await page.keyboard.type("DEMO-101");
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=DEMO-101/);
  log((await page.getByRole("link", { name: /DEMO-101/ }).count()) > 0, `[${label}] keyboard search finds course`);
  await page.getByRole("link", { name: /DEMO-101 · / }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/courses\/demo-101/);
  await axe(page, `[${label}] course page`);
  await shot(page, `${label}-course`);
  await page.goto(`${BASE}/practice/setup?course=demo-101&unreviewed=1`);
  await axe(page, `[${label}] practice setup`);
  await shot(page, `${label}-setup`);
  await page.getByRole("button", { name: "Got it" }).click().catch(() => {});
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: /^Start/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/practice\/[0-9a-f-]{36}$/);
  await page.getByText(/Question 1 of 5/).waitFor();
  await axe(page, `[${label}] practice session`);
  await shot(page, `${label}-session`);

  for (let i = 0; i < 5; i++) {
    // radio group: focus first radio, arrow keys + Space, then Check answer by keyboard
    await page.locator('input[type="radio"]').first().focus();
    if (i % 2) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Check answer" }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Feedback").waitFor();
    if (i === 0) {
      const txt = await page.getByLabel("Feedback").innerText();
      log(/Correct|Incorrect/.test(txt), `[${label}] feedback uses text, not just colour (“${txt.split("\n")[0]}”)`);
      const tags = await page.locator(".status-tag").allInnerTexts();
      log(tags.some((t) => /Correct answer/.test(t)), `[${label}] correct option is labelled in text`);
      await axe(page, `[${label}] practice feedback`);
      await shot(page, `${label}-feedback`);
    }
    if (i < 4) await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByRole("button", { name: "Finish session" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "See results" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Results" }).waitFor();
  const body = await page.locator("main").innerText();
  log(/Answered/.test(body) && /Skipped/.test(body) && /By topic/.test(body), `[${label}] results page shows totals and topic table`);
  await axe(page, `[${label}] results`);
  await shot(page, `${label}-results`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  log(!overflow, `[${label}] no horizontal page scroll`);
  // refresh persistence: reload shows results again
  await page.reload();
  await page.getByRole("heading", { name: "Results" }).waitFor();
  log(true, `[${label}] results survive a refresh`);
  log(errors.length === 0, `[${label}] no console/page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await browser.close();
}

async function authedPages() {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, bypassCSP: true });
  const page = await ctx.newPage();
  for (const p of ["/about", "/guidelines", "/academic-integrity", "/privacy", "/content-removal", "/auth/sign-in", "/saved", "/contribute"]) {
    await page.goto(BASE + p);
    await axe(page, p);
  }
  await page.goto(BASE + "/auth/sign-in");
  await page.getByLabel("Email").fill("demo-reviewer@example.test");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(BASE + "/");
  await page.goto(BASE + "/moderation");
  await page.getByRole("heading", { name: "Moderation" }).waitFor();
  await axe(page, "moderation queue");
  await shot(page, "moderation");
  await page.getByRole("link", { name: "Review", exact: true }).first().click();
  await page.getByRole("heading", { name: /Review:/ }).waitFor();
  await axe(page, "review panel");
  await shot(page, "review");
  await page.goto(BASE + "/contribute/new");
  await page.getByRole("button", { name: "Show preview" }).click();
  await axe(page, "contribution editor");
  await shot(page, "editor");
  await page.goto(BASE + "/contribute/notes");
  await page.getByRole("heading", { name: "Share your notes" }).waitFor();
  await axe(page, "share notes form");
  await shot(page, "notes");
  await browser.close();
}

async function darkPass() {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, bypassCSP: true, colorScheme: "dark" });
  const page = await ctx.newPage();
  for (const p of ["/", "/courses/demo-101?review=all", "/practice/setup?course=demo-101&unreviewed=1", "/about", "/auth/sign-in", "/contribute/new"]) {
    await page.goto(BASE + p);
    await axe(page, `[dark] ${p}`);
  }
  // A real session in dark mode: answer one question to check correct/incorrect colours.
  const res = await page.request.post(BASE + "/api/sessions", { data: { courseId: (await (await page.request.get(BASE + "/api/courses/demo-101")).json()).id, count: 3, mode: "practice", includeUnreviewed: true }, headers: { Origin: BASE } });
  const { id } = await res.json();
  await page.goto(`${BASE}/practice/${id}`);
  await page.locator('input[type="radio"]').first().check();
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByLabel("Feedback").waitFor();
  await axe(page, "[dark] practice feedback");
  await shot(page, "dark-feedback");
  await page.goto(BASE);
  await shot(page, "dark-home");
  await browser.close();
}

async function prodStyleSignIn() {
  const url = process.env.PROD_URL;
  if (!url) return;
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
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
  await browser.close();
}

(async () => {
  await prodStyleSignIn();
  await guestFlow(1100, 900, "desktop");
  await guestFlow(375, 760, "mobile");
  await authedPages();
  await darkPass();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll browser checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
