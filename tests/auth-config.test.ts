import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { getDb } from "@/lib/db";
import { promoteConfiguredMaintainer } from "@/lib/bootstrap";
import { buildAuthOptions, getAuth, randomDisplayName, resetAuthForTests } from "@/lib/auth";

const KEYS = ["OPENFRAME_DEMO", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_SECRET", "BASE_URL"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  KEYS.forEach((k) => (saved[k] = process.env[k]));
  freshDb();
  resetAuthForTests();
});
afterEach(() => {
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  resetAuthForTests();
});

// The HTTP-level "password login is refused in production mode" checks run against a real server in scripts/prod-config-check.ts.
const post = (path: string, body: unknown) =>
  getAuth().handler(new Request(`http://localhost:3000/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(body) }));

describe("authentication configuration", () => {
  it("disables password sign-in outside demo mode", () => {
    delete process.env.OPENFRAME_DEMO;
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(buildAuthOptions().emailAndPassword.enabled).toBe(false);
  });

  it("allows password sign-up only in demo mode", () => {
    process.env.OPENFRAME_DEMO = "1";
    expect(buildAuthOptions().emailAndPassword.enabled).toBe(true);
  });

  it("starts a Google OAuth flow with PKCE and the right redirect when configured", async () => {
    delete process.env.OPENFRAME_DEMO;
    process.env.BASE_URL = "http://localhost:3000";
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    const res = await post("/sign-in/social", { provider: "google", callbackURL: "/" });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/google");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(u.searchParams.get("prompt")).toBe("select_account");
    expect(u.searchParams.get("scope")).toMatch(/openid/);
    expect(u.searchParams.get("scope")).not.toMatch(/calendar|drive|gmail/);
  });

  it("offers no Google provider when it is not configured", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(Object.keys(buildAuthOptions().socialProviders)).toHaveLength(0);
  });

  it("refuses a half-configured Google client", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(() => getAuth()).toThrow(/both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
  });

  it("replaces Google's real name and photo with a pseudonym", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const g = (buildAuthOptions().socialProviders as { google: { mapProfileToUser: (p: unknown) => { name: string; image: string } } }).google;
    const mapped = g.mapProfileToUser({ name: "Real Person", given_name: "Real", picture: "https://lh3.googleusercontent.com/x", email: "p@example.com" });
    expect(mapped.name).toMatch(/^student-\d{4}$/);
    expect(mapped.name).not.toContain("Real");
    expect(mapped.image).toBe("");
    expect(randomDisplayName()).toMatch(/^student-\d{4}$/);
  });
});

describe("maintainer bootstrap (INITIAL_MAINTAINER_EMAILS)", () => {
  const mk = (email: string, verified: number, role = "student") => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?,?,?,?,?,?,?)').run(id, "n", email, verified, "x", "x", role);
    return id;
  };
  const roleOf = (id: string) => (getDb().prepare('SELECT role FROM "user" WHERE id = ?').get(id) as { role: string }).role;

  afterEach(() => delete process.env.INITIAL_MAINTAINER_EMAILS);

  it("promotes a listed, verified email (case-insensitively) and logs it", () => {
    process.env.INITIAL_MAINTAINER_EMAILS = " Owner@Example.com , other@example.com ";
    const id = mk("owner@example.com", 1);
    expect(promoteConfiguredMaintainer(id)).toBe(true);
    expect(roleOf(id)).toBe("maintainer");
    expect(promoteConfiguredMaintainer(id)).toBe(false); // already maintainer
    const ev = getDb().prepare("SELECT action FROM moderation_event WHERE action = 'role_granted_by_config'").all();
    expect(ev).toHaveLength(1);
  });
  it("never promotes an unverified email, an unlisted email, or when nothing is configured", () => {
    process.env.INITIAL_MAINTAINER_EMAILS = "owner@example.com";
    const unverified = mk("owner@example.com", 0);
    const unlisted = mk("someone@example.com", 1);
    expect(promoteConfiguredMaintainer(unverified)).toBe(false);
    expect(promoteConfiguredMaintainer(unlisted)).toBe(false);
    expect(roleOf(unverified)).toBe("student");
    expect(roleOf(unlisted)).toBe("student");
    delete process.env.INITIAL_MAINTAINER_EMAILS;
    const verified = mk("owner2@example.com", 1);
    expect(promoteConfiguredMaintainer(verified)).toBe(false);
  });
  it("never demotes", () => {
    process.env.INITIAL_MAINTAINER_EMAILS = "someone-else@example.com";
    const id = mk("keeps@example.com", 1, "maintainer");
    promoteConfiguredMaintainer(id);
    expect(roleOf(id)).toBe("maintainer");
  });
});
