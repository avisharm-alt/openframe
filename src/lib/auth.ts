import { betterAuth } from "better-auth";
import { getDb } from "./db";
import { config } from "./config";

/**
 * Better Auth (email + password, cookie sessions). The `role` column is server-controlled
 * (`input: false`): clients cannot set it through sign-up or update-user. Roles are granted
 * only by a maintainer with shell access via `npm run admin:grant`.
 */
export function buildAuthOptions() {
  return {
    appName: "OpenFrame",
    baseURL: config.baseUrl,
    secret: config.authSecret,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        role: { type: "string" as const, required: false, defaultValue: "student", input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-up/email": { window: 3600, max: config.signupLimitPerHour },
        "/sign-in/email": { window: 60, max: config.signinLimitPerMinute },
      },
    },
    advanced: {
      useSecureCookies: config.isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" as const },
      ipAddress: {
        ipAddressHeaders: config.trustProxy ? ["x-forwarded-for"] : [],
      },
    },
  };
}

function make() {
  return betterAuth({ ...buildAuthOptions(), database: getDb() });
}
type Auth = ReturnType<typeof make>;
const g = globalThis as unknown as { __openframeAuth?: Auth };

export function getAuth(): Auth {
  if (!g.__openframeAuth) g.__openframeAuth = make();
  return g.__openframeAuth;
}
