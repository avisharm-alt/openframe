import { getDb } from "./db";
import { config } from "./config";
import { logAudit } from "./services/audit";

/**
 * Called on every sign-in. If the account's email is listed in INITIAL_ADMIN_EMAILS AND the email
 * is verified by the identity provider, the account is made an admin. Unverified emails (for example
 * demo password sign-ups) are never promoted, so nobody can claim a listed address by typing it.
 * Returns true if a promotion happened.
 */
export function promoteConfiguredAdmin(userId: string): boolean {
  const listed = config.initialAdminEmails;
  if (listed.length === 0) return false;
  const db = getDb();
  const u = db.prepare('SELECT email, emailVerified, role FROM "user" WHERE id = ?').get(userId) as
    | { email: string; emailVerified: number; role: string | null }
    | undefined;
  if (!u || !u.emailVerified || u.role === "admin" || !listed.includes(u.email.trim().toLowerCase())) return false;
  db.prepare('UPDATE "user" SET role = ? WHERE id = ?').run("admin", userId);
  logAudit(null, "role_granted_by_config", { subjectType: "user", subjectId: userId, detail: { role: "admin" } });
  return true;
}
