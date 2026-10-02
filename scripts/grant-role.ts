// Usage: npm run admin:grant -- someone@example.org reviewer|maintainer|student
// Roles can only be changed here (shell access to the server); there is no API for it.
import { getDb } from "../src/lib/db";
import { logEvent } from "../src/lib/services/events";

const [email, role] = process.argv.slice(2);
if (!email || !["student", "reviewer", "maintainer"].includes(role)) {
  console.error("Usage: npm run admin:grant -- <email> <student|reviewer|maintainer>");
  process.exit(1);
}
const db = getDb();
const r = db.prepare('UPDATE "user" SET role = ? WHERE lower(email) = lower(?)').run(role, email);
if (!r.changes) {
  console.error("No user with that email.");
  process.exit(1);
}
logEvent(null, "role_granted", { detail: { role } });
console.log(`Set role of ${email} to ${role}.`);
