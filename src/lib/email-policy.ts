// Pure helpers (no server dependencies) so they can be unit tested.

/**
 * Returns an error message if the address may not register, or null if it is acceptable.
 * Exact domain match on the part after the LAST "@" (so "x@uwo.ca.evil.com" and "uwo.ca@evil.com" fail).
 * When a domain list is enforced, "+tag" aliases are refused: one mailbox must map to one account,
 * otherwise a single student could create several accounts and sidestep the independent-reviewer rule.
 */
export function emailPolicyError(email: string, allowedDomains: string[]): string | null {
  if (allowedDomains.length === 0) return null;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  const local = at > 0 ? e.slice(0, at) : "";
  const domain = at > 0 ? e.slice(at + 1) : "";
  if (!local || !allowedDomains.includes(domain)) {
    const list = allowedDomains.map((d) => `@${d}`).join(" or ");
    return `Accounts are limited to ${list} email addresses for now.`;
  }
  if (local.includes("+")) return "Please use your plain university address without a “+” alias.";
  return null;
}
