// Pluggable email. Services never talk to a mail service directly: they queue a message here, and whichever
// provider EMAIL_PROVIDER names delivers it. The default is "console" (one log line, no address, no body) and
// "noop" is silent, so nothing external is needed to run OpenFrame.
//
// To add a real provider, implement EmailProvider and register it, for example in a file imported at startup:
//   registerEmailProvider("postmark", () => ({ name: "postmark", send: async (m) => { /* call the API */ } }));
// then set EMAIL_PROVIDER=postmark. Delivery failures are logged and never break the action that caused them.
import { config } from "./config";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Stable name of the notification (for example "pickup_scheduled"), useful for provider-side templates. */
  template: string;
};
export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<void>;
}

const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

const consoleProvider: EmailProvider = {
  name: "console",
  async send(m) {
    console.log(`[email:console] template=${m.template} to=${maskEmail(m.to)} subject=${JSON.stringify(m.subject)}`);
  },
};
const noopProvider: EmailProvider = { name: "noop", async send() {} };

const registry = new Map<string, () => EmailProvider>([
  ["console", () => consoleProvider],
  ["noop", () => noopProvider],
]);
export function registerEmailProvider(name: string, factory: () => EmailProvider) {
  registry.set(name.toLowerCase(), factory);
}

let override: EmailProvider | null = null;
/** Test helper: capture messages instead of delivering them (pass null to restore). */
export function setEmailProvider(p: EmailProvider | null) {
  override = p;
}
export function getEmailProvider(): EmailProvider {
  if (override) return override;
  const make = registry.get(config.emailProvider);
  if (!make) {
    console.error(`[email] Unknown EMAIL_PROVIDER "${config.emailProvider}"; using "console".`);
    return consoleProvider;
  }
  return make();
}

/** Fire-and-forget: the provider is invoked immediately, failures are logged, and the caller never waits or fails. */
export function queueEmail(msg: EmailMessage): void {
  try {
    getEmailProvider()
      .send(msg)
      .catch((e) => console.error(`[email] delivery failed for template=${msg.template}:`, e instanceof Error ? e.message : e));
  } catch (e) {
    console.error(`[email] delivery failed for template=${msg.template}:`, e instanceof Error ? e.message : e);
  }
}
