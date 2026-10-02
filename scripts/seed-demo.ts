// Local/demo only. Creates demo courses, ~24 UNREVIEWED demo questions, three demo accounts (student, reviewer,
// maintainer) and one pending submission so the review workflow can be tried. Refuses to run in production.
import { getDb, setDb } from "../src/lib/db";
import { getAuth } from "../src/lib/auth";
import { config } from "../src/lib/config";
import { seedDemoContent } from "../src/lib/seed";
import { createDraft, submit } from "../src/lib/services/contributions";
import { contributionTargets } from "../src/lib/services/catalog";
import { SEED_COURSES } from "../src/lib/seed-data";

const PASSWORD = "demo-password-123";
const DEMO_USERS = [
  { name: "Demo Student", email: "demo-student@example.test", role: "student" },
  { name: "Demo Reviewer", email: "demo-reviewer@example.test", role: "reviewer" },
  { name: "Demo Maintainer", email: "demo-maintainer@example.test", role: "maintainer" },
];

async function main() {
  if (config.isProd || !config.demo) {
    console.error("Refusing to seed: set OPENFRAME_DEMO=1 and do not run in production.");
    process.exit(1);
  }
  const db = getDb();
  const created = seedDemoContent(db);
  console.log(created.length ? `Seeded ${created.length} demo courses.` : "Demo courses already present.");

  const ids: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const existing = db.prepare('SELECT id FROM "user" WHERE email = ?').get(u.email) as { id: string } | undefined;
    if (existing) {
      ids[u.email] = existing.id;
      continue;
    }
    const r = await getAuth().api.signUpEmail({ body: { name: u.name, email: u.email, password: PASSWORD } });
    ids[u.email] = r.user.id;
    db.prepare('UPDATE "user" SET role = ?, emailVerified = 1 WHERE id = ?').run(u.role, r.user.id);
  }

  const student = { id: ids["demo-student@example.test"], role: "student" as const };
  const already = db.prepare("SELECT 1 FROM question WHERE author_id = ?").get(student.id);
  if (!already) {
    const course = contributionTargets().find((c) => c.code === SEED_COURSES[0].code)!;
    const topic = course.topics.find((t) => t.title === "Control flow")!;
    const o = Array.from({ length: 4 }, () => crypto.randomUUID());
    const { id } = createDraft(student, {
      courseId: course.id,
      topicId: topic.id,
      stem: "Which loop construct is the best fit when the number of iterations is not known before the loop starts?",
      learningObjective: "Choose between definite and indefinite iteration constructs for a described task.",
      options: [
        { id: o[0], text: "A `while` loop with a stopping condition", explanation: "A while loop repeats until a condition changes, which suits an unknown iteration count." },
        { id: o[1], text: "A `for` loop over a fixed `range`", explanation: "A fixed range commits to the iteration count in advance." },
        { id: o[2], text: "A single `if` statement", explanation: "An if statement runs its body at most once and does not repeat." },
        { id: o[3], text: "A function definition with no body", explanation: "A function definition does not repeat anything by itself." },
      ],
      correctOptionId: o[0],
      difficulty: "introductory",
      aiProvenance: "ai_generated",
      checkDescription: "Demo submission created by the seed script to exercise the review workflow.",
    });
    submit(student, id, true);
    console.log("Created a pending demo submission for the reviewer queue.");
  }
  console.log(`\nDemo accounts (password: ${PASSWORD}):\n${DEMO_USERS.map((u) => `  ${u.email}  (${u.role})`).join("\n")}`);
  setDb(undefined);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
