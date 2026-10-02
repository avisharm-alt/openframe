// Runs against a SECOND server started without demo mode and with a dummy Google client, to prove the
// production-style behaviour over real HTTP: no password login, valid Google OAuth start, sign-in page content.
//   BASE_URL=http://localhost:3101 GOOGLE_CLIENT_ID=... tsx scripts/prod-config-check.ts
const BASE = process.env.BASE_URL || "http://localhost:3101";
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  [prod-style] ${name}${ok ? "" : "  -> " + extra}`);
  if (!ok) failures++;
};
const post = (path: string, body: unknown) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });

(async () => {
  const h = await fetch(BASE + "/api/health");
  check("health endpoint is up", h.status === 200 && ((await h.json()) as { status: string }).status === "ok");
  const up = await post("/api/auth/sign-up/email", { name: "x", email: "someone@example.com", password: "correct-horse-battery" });
  check("password sign-up is refused outside demo mode", up.status === 400, String(up.status));
  const inn = await post("/api/auth/sign-in/email", { email: "someone@example.com", password: "correct-horse-battery" });
  check("password sign-in is refused outside demo mode", inn.status === 400, String(inn.status));

  const g = await post("/api/auth/sign-in/social", { provider: "google", callbackURL: "/", newUserCallbackURL: "/account?welcome=1", errorCallbackURL: "/auth/sign-in?error=oauth" });
  const { url } = (await g.json()) as { url?: string };
  const u = new URL(url ?? "http://invalid");
  check("Google sign-in starts at accounts.google.com", u.origin === "https://accounts.google.com", url ?? "");
  check("OAuth request carries our client id and exact redirect URI", u.searchParams.get("client_id") === CLIENT_ID && u.searchParams.get("redirect_uri") === `${BASE}/api/auth/callback/google`, url ?? "");
  check("OAuth request uses PKCE (S256) and a state value", u.searchParams.get("code_challenge_method") === "S256" && !!u.searchParams.get("state"));
  check("only basic scopes are requested", (u.searchParams.get("scope") ?? "").split(/[ +]/).sort().join(",") === "email,openid,profile", u.searchParams.get("scope") ?? "");

  const page = await (await fetch(BASE + "/auth/sign-in")).text();
  check("sign-in page offers Google and no password form", page.includes("Continue with Google") && !page.includes("Demo accounts"));
  const cross = await fetch(BASE + "/api/auth/sign-in/social", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ provider: "google" }) });
  check("cross-origin attempt to start sign-in is rejected", cross.status === 403, String(cross.status));
  const me = await (await fetch(BASE + "/api/me")).json();
  check("guests have no session", (me as { user: unknown }).user === null);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
