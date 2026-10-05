// Central environment configuration. Nothing here requires external credentials.
const bool = (v: string | undefined) => v === "1" || v === "true";
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  get baseUrl() {
    return process.env.BASE_URL || "http://localhost:3000";
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  get isBuild() {
    return process.env.NEXT_PHASE === "phase-production-build";
  },
  get databasePath() {
    return process.env.DATABASE_PATH || "./data/openframe.db";
  },
  get demo() {
    return bool(process.env.OPENFRAME_DEMO);
  },
  get trustProxy() {
    return bool(process.env.TRUST_PROXY);
  },
  /** A URL or mailto: link for questions, concerns and data-removal requests. Leave unset until it is monitored. */
  get contact() {
    return (process.env.CONTACT_URL || "").trim();
  },
  get securityContact() {
    return (process.env.SECURITY_CONTACT || "").trim();
  },
  get authSecret() {
    const s = process.env.AUTH_SECRET;
    if (s && s.length >= 32) return s;
    if (this.isProd && !this.isBuild) {
      throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters in production.");
    }
    return "dev-only-secret-do-not-use-in-production-0123456789";
  },
  /** Google OAuth client (create one in Google Cloud Console; see README). Both must be set to enable Google sign-in. */
  get googleClientId() {
    return (process.env.GOOGLE_CLIENT_ID || "").trim();
  },
  get googleClientSecret() {
    return (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  },
  get googleEnabled() {
    return !!this.googleClientId && !!this.googleClientSecret;
  },
  /** Email+password sign-in exists ONLY in demo mode, so the demo, seed script and tests work without Google. */
  get passwordLoginEnabled() {
    return this.demo;
  },
  /**
   * Comma-separated emails that become admins when they sign in with a VERIFIED email (Google).
   * Lets you bootstrap the first admin on a host without shell access. It only promotes; it never demotes.
   * INITIAL_MAINTAINER_EMAILS (the old name) is still read so existing deployments keep working.
   */
  get initialAdminEmails(): string[] {
    return (process.env.INITIAL_ADMIN_EMAILS || process.env.INITIAL_MAINTAINER_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  /**
   * Secret that encrypts pickup addresses, access notes and phone numbers at rest (AES-256-GCM; the 32-byte key is
   * derived from this string). Required in production: generate with `openssl rand -base64 48`.
   * Losing it makes stored pickup details unreadable, which is acceptable because they are purged within days.
   */
  get pickupEncryptionSecret() {
    const s = process.env.PICKUP_ENCRYPTION_KEY;
    if (s && s.length >= 32) return s;
    if (this.isProd && !this.isBuild) {
      throw new Error("PICKUP_ENCRYPTION_KEY must be set to a random string of at least 32 characters in production.");
    }
    return "dev-only-pickup-key-do-not-use-in-production-0123456789";
  },
  /** Pickup address, notes and phone are erased this many days after a pledge is collected, cancelled or a no-show. */
  get pickupPurgeDays() {
    return num(process.env.PICKUP_PURGE_DAYS, 7);
  },
  /** Coordinators and volunteers see a pickup's address from this many hours before its window. */
  get pickupVisibleHoursBefore() {
    return num(process.env.PICKUP_VISIBLE_HOURS_BEFORE, 24);
  },
  /** Pickups still open this many hours after their window ended are flagged overdue. */
  get pickupOverdueHours() {
    return num(process.env.PICKUP_OVERDUE_HOURS, 2);
  },
  /** A pickup claim still waiting to be scheduled this many hours after it was made is released and its request reopens. */
  get claimReleaseHours() {
    return num(process.env.CLAIM_RELEASE_HOURS, 48);
  },
  /** A request still unfilled this many days before (or after) its needed-by date alerts coordinators. */
  get requestRiskDays() {
    return num(process.env.REQUEST_RISK_DAYS, 2);
  },
  /** "console" (default) logs a one-line summary; "noop" is silent. Real providers: see src/lib/email.ts. */
  get emailProvider() {
    return (process.env.EMAIL_PROVIDER || "console").trim().toLowerCase();
  },
  get signupLimitPerHour() {
    return num(process.env.AUTH_SIGNUP_LIMIT_PER_HOUR, 10);
  },
  get signinLimitPerMinute() {
    return num(process.env.AUTH_SIGNIN_LIMIT_PER_MINUTE, 10);
  },
};
