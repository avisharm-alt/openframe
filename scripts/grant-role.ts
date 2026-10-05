// Usage:
//   npm run admin:grant -- someone@example.org admin|member
//   npm run admin:grant -- someone@example.org coordinator|volunteer|none --chapter london
// Global roles and chapter coordinators can be set here (shell access). Admins can also do it from /admin.
import { getDb } from "../src/lib/db";
import { logAudit } from "../src/lib/services/audit";
import { nowDate } from "../src/lib/time";

const args = process.argv.slice(2);
const ci = args.indexOf("--chapter");
const chapterSlug = ci >= 0 ? args.splice(ci, 2)[1] : undefined;
const [email, role] = args;
const usage = "Usage: npm run admin:grant -- <email> <admin|member>\n       npm run admin:grant -- <email> <coordinator|volunteer|none> --chapter <slug>";
if (!email || !role) {
  console.error(usage);
  process.exit(1);
}
const db = getDb();
const user = db.prepare('SELECT id FROM "user" WHERE lower(email) = lower(?)').get(email) as { id: string } | undefined;
if (!user) {
  console.error("No user with that email. They need to sign in once first.");
  process.exit(1);
}
if (chapterSlug) {
  const ch = db.prepare("SELECT id FROM chapter WHERE slug = ?").get(chapterSlug) as { id: string } | undefined;
  if (!ch) {
    console.error(`No chapter with slug "${chapterSlug}".`);
    process.exit(1);
  }
  if (!["coordinator", "volunteer", "none"].includes(role)) {
    console.error(usage);
    process.exit(1);
  }
  if (role === "none") db.prepare("DELETE FROM chapter_member WHERE chapter_id = ? AND user_id = ?").run(ch.id, user.id);
  else
    db.prepare(
      "INSERT INTO chapter_member (chapter_id, user_id, role, granted_by, created_at) VALUES (?,?,?,NULL,?) ON CONFLICT (chapter_id, user_id) DO UPDATE SET role = excluded.role",
    ).run(ch.id, user.id, role, nowDate().toISOString());
  logAudit(null, "chapter_role_set_by_shell", { chapterId: ch.id, subjectType: "user", subjectId: user.id, detail: { role } });
  console.log(`Set ${email} to ${role} in ${chapterSlug}.`);
} else {
  if (!["admin", "member"].includes(role)) {
    console.error(usage);
    process.exit(1);
  }
  db.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(role, user.id);
  logAudit(null, "role_granted", { subjectType: "user", subjectId: user.id, detail: { role } });
  console.log(`Set role of ${email} to ${role}.`);
}
