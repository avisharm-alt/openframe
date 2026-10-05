// Usage: npm run admin:add-chapter -- "<name>" "<city>" <timezone> [slug]
//   npm run admin:add-chapter -- "Toronto (UofT)" "Toronto, ON" America/Toronto toronto
// Chapters are data, not code. Admins can also do this on the /admin page. Then appoint its first coordinator:
//   npm run admin:grant -- someone@example.org coordinator --chapter toronto
import { getDb } from "../src/lib/db";
import { createChapter } from "../src/lib/services/chapters";

const [name, city, timezone, slug] = process.argv.slice(2);
if (!name || !city || !timezone) {
  console.error('Usage: npm run admin:add-chapter -- "<name>" "<city>" <timezone> [slug]');
  process.exit(1);
}
const admin = getDb().prepare(`SELECT id FROM "user" WHERE role = 'admin' ORDER BY createdAt LIMIT 1`).get() as { id: string } | undefined;
const c = createChapter({ id: admin?.id ?? "shell", role: "admin" }, { name, city, timezone, ...(slug ? { slug } : {}) });
console.log(`Created chapter "${c.name}" at /?chapter=${c.slug}. Add a coordinator with: npm run admin:grant -- <email> coordinator --chapter ${c.slug}`);
