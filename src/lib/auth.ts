import { betterAuth } from "better-auth";
import { getDb } from "./db";
import { APIError } from "better-auth/api";
import { config } from "./config";
import { emailPolicyError } from "./email-policy";
import { sendEmail } from "./email";

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
      requireEmailVerification: config.requireEmailVerification,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your OpenFrame password",
          text: `Someone asked to reset the password for this OpenFrame account.\n\nIf it was you, open this link within one hour:\n${url}\n\nIf it wasn't you, ignore this email; your password has not changed.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your email for OpenFrame",
          text: `Welcome to OpenFrame. Confirm this email address to finish creating your account:\n${url}\n\nThe link expires in 24 hours. If you didn't sign up, ignore this email.`,
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Single choke point for every account creation path (sign-up API, scripts).
          before: async (user: { email: string }) => {
            const problem = emailPolicyError(user.email, config.allowedEmailDomains);
            if (problem) throw new APIError("BAD_REQUEST", { message: problem });
            return { data: user };
          },
        },
      },
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
  if (config.isProd && !config.isBuild && config.requireEmailVerification && !config.smtpUrl && !config.demo) {
    throw new Error("SMTP_URL must be set: email verification is required (ALLOWED_EMAIL_DOMAINS / REQUIRE_EMAIL_VERIFICATION).");
  }
  return betterAuth({ ...buildAuthOptions(), database: getDb() });
}
type Auth = ReturnType<typeof make>;
const g = globalThis as unknown as { __openframeAuth?: Auth };

export function getAuth(): Auth {
  if (!g.__openframeAuth) g.__openframeAuth = make();
  return g.__openframeAuth;
}
