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
  get contentRemovalContact() {
    return (process.env.CONTENT_REMOVAL_CONTACT || "").trim();
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
  /** Lower-case domains allowed to create accounts, e.g. ["uwo.ca"]. Empty = unrestricted (local/demo only). */
  get allowedEmailDomains(): string[] {
    return (process.env.ALLOWED_EMAIL_DOMAINS || "")
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
  },
  /** A domain allow-list is meaningless without proving the address, so it forces verification. */
  get requireEmailVerification() {
    return this.allowedEmailDomains.length > 0 || bool(process.env.REQUIRE_EMAIL_VERIFICATION);
  },
  get smtpUrl() {
    return (process.env.SMTP_URL || "").trim();
  },
  get emailFrom() {
    return (process.env.EMAIL_FROM || "OpenFrame <no-reply@localhost>").trim();
  },
  get emailOutboxPath() {
    return process.env.EMAIL_OUTBOX_PATH || "./data/outbox.jsonl";
  },
  get signupLimitPerHour() {
    return num(process.env.AUTH_SIGNUP_LIMIT_PER_HOUR, 10);
  },
  get signinLimitPerMinute() {
    return num(process.env.AUTH_SIGNIN_LIMIT_PER_MINUTE, 10);
  },
};

export { ATTESTATION_TEXT } from "./attestation";
