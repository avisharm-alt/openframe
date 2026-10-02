import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { config } from "./config";

export type Mail = { to: string; subject: string; text: string };

/**
 * Sends plain-text email.
 * - Production: SMTP via SMTP_URL (any provider that offers SMTP).
 * - Demo/e2e only (OPENFRAME_DEMO=1, no SMTP_URL): the message is logged and appended to a local outbox file
 *   so verification/reset links can be followed without a mail server. This is a substitute, not real delivery.
 */
export async function sendEmail(mail: Mail): Promise<void> {
  if (config.smtpUrl) {
    const transport = nodemailer.createTransport(config.smtpUrl);
    await transport.sendMail({ from: config.emailFrom, ...mail });
    return;
  }
  if (!config.demo) {
    throw new Error("Email is not configured: set SMTP_URL (and EMAIL_FROM). Refusing to drop a verification email silently.");
  }
  const file = config.emailOutboxPath;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...mail }) + "\n");
  console.log(`[demo email] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
}
