import crypto from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getDb } from "./db";
import { config } from "./config";
import { promoteConfiguredMaintainer } from "./bootstrap";

/**
 * Better Auth with cookie sessions.
 * - Production sign-in is Google OAuth only (no passwords stored). Email+password exists only in demo mode.
 * - Google's real name and photo are discarded at sign-in: every new account gets a random pseudonymous
 *   display name that the user can change on /account.
 * - The `role` column is server-controlled (`input: false`): clients cannot set it through any endpoint.
 *   Roles are granted only by a maintainer with shell access via `npm run admin:grant`.
 */
export function buildAuthOptions() {
  return {
    appName: "OpenFrame",
    baseURL: config.baseUrl,
    secret: config.authSecret,
    emailAndPassword: {
      enabled: config.passwordLoginEnabled,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    socialProviders: config.googleEnabled
      ? {
          google: {
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
            prompt: "select_account" as const,
            // Data minimisation: keep neither the real name nor the profile picture.
            mapProfileToUser: () => ({ name: randomDisplayName(), image: "" }),
          },
        }
      : {},
    account: { encryptOAuthTokens: true },
    user: {
      additionalFields: {
        role: { type: "string" as const, required: false, defaultValue: "student", input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Bootstrap maintainers from INITIAL_MAINTAINER_EMAILS (verified emails only).
          before: async (session: Record<string, unknown> & { userId: string }) => {
            promoteConfiguredMaintainer(session.userId);
            return { data: session };
          },
        },
      },
      user: {
        update: {
          before: async (data: Record<string, unknown>) => {
            if (typeof data.name === "string") {
              const name = data.name.trim();
              if (name.length < 2 || name.length > 40) {
                throw new APIError("BAD_REQUEST", { message: "Display name must be 2 to 40 characters." });
              }
              return { data: { ...data, name } };
            }
            return { data };
          },
        },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/social": { window: 60, max: 30 },
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

export const randomDisplayName = () => `student-${crypto.randomInt(1000, 10000)}`;

function make() {
  if (!!config.googleClientId !== !!config.googleClientSecret) {
    throw new Error("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or neither).");
  }
  return betterAuth({ ...buildAuthOptions(), database: getDb() });
}
type Auth = ReturnType<typeof make>;
const g = globalThis as unknown as { __openframeAuth?: Auth };

export function getAuth(): Auth {
  if (!g.__openframeAuth) g.__openframeAuth = make();
  return g.__openframeAuth;
}

/** Test helper: forget the cached instance so changed environment variables take effect. */
export function resetAuthForTests() {
  g.__openframeAuth = undefined;
}
