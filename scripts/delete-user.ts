// Usage: npm run admin:delete-user -- someone@example.org
// Maintainer tool for deletion requests: same behaviour as self-service account deletion.
import { getDb } from "../src/lib/db";
import { deleteAccount } from "../src/lib/services/account";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run admin:delete-user -- <email>");
  process.exit(1);
}
const u = getDb().prepare('SELECT id FROM "user" WHERE lower(email) = lower(?)').get(email) as { id: string } | undefined;
if (!u) {
  console.error("No user with that email.");
  process.exit(1);
}
deleteAccount(u.id);
console.log("Account deleted.");
