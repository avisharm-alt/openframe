// Local/demo only. Creates demo accounts for every role, both chapters' zones, partners, requests, stock, kits and
// claims in every state. Refuses to run in production. Idempotent: does nothing if the demo accounts already exist.
//   OPENFRAME_DEMO=1 npm run db:seed-demo
import { getDb, setDb } from "../src/lib/db";
import { getAuth } from "../src/lib/auth";
import { config } from "../src/lib/config";
import { DEMO_EMAIL, seedDemoData, type DemoUsers } from "../src/lib/seed";
import type { Actor, Role } from "../src/lib/types";

process.env.EMAIL_PROVIDER ??= "noop"; // do not log a line for every seeded email
const PASSWORD = "demo-password-123";

async function account(name: string, role: Role = "member"): Promise<Actor> {
  const db = getDb();
  const email = `${name.toLowerCase().replace(/\s+/g, "-")}@example.test`;
  const r = await getAuth().api.signUpEmail({ body: { name, email, password: PASSWORD } });
  db.prepare('UPDATE "user" SET role = ?, emailVerified = 1 WHERE id = ?').run(role, r.user.id);
  return { id: r.user.id, role, name };
}

async function main() {
  if (config.isProd || !config.demo) {
    console.error("Refusing to seed: set OPENFRAME_DEMO=1 and do not run in production.");
    process.exit(1);
  }
  const db = getDb();
  if (db.prepare('SELECT 1 FROM "user" WHERE email = ?').get("demo-admin@example.test")) {
    console.log("Demo data already present.");
    return;
  }
  const users: DemoUsers = {
    admin: await account("Demo Admin", "admin"),
    londonCoordinator: await account("Demo London Coordinator"),
    oshawaCoordinator: await account("Demo Oshawa Coordinator"),
    londonVolunteers: [await account("Demo London Volunteer 1"), await account("Demo London Volunteer 2"), await account("Demo London Volunteer 3")],
    newVolunteer: await account("Demo New Volunteer"),
    oshawaVolunteers: [await account("Demo Oshawa Volunteer 1"), await account("Demo Oshawa Volunteer 2")],
    neighbours: [],
    londonWorker: await account("Demo London Worker"),
    londonWorker2: await account("Demo Downtown Worker"),
    pendingWorker: await account("Demo Pending Worker"),
    applicant: await account("Demo Partner Applicant"),
    oshawaWorker: await account("Demo Oshawa Worker"),
  };
  for (let n = 1; n <= 6; n++) users.neighbours.push(await account(`Demo Neighbour ${n}`));
  await account("Demo New Neighbour"); // no claims: used for trying the claim flow
  seedDemoData(users);
  const all = [
    users.admin, users.londonCoordinator, users.oshawaCoordinator, ...users.londonVolunteers, users.newVolunteer, ...users.oshawaVolunteers,
    users.londonWorker, users.londonWorker2, users.pendingWorker, users.applicant, users.oshawaWorker, ...users.neighbours,
  ];
  console.log(`Seeded both chapters: partners with delivery sites, requests and claims in every state, stock, kits, shifts and deliveries.\n\nDemo accounts (password: ${PASSWORD}):`);
  const role = (a: Actor) =>
    a === users.admin ? "admin"
    : a === users.londonCoordinator ? "coordinator, London"
    : a === users.oshawaCoordinator ? "coordinator, Oshawa"
    : users.londonVolunteers.includes(a) ? "volunteer, London"
    : a === users.newVolunteer ? "volunteer, London (has not acknowledged the Safety rules)"
    : users.oshawaVolunteers.includes(a) ? "volunteer, Oshawa"
    : a === users.londonWorker ? "agency worker, Ark Aid Street Mission"
    : a === users.londonWorker2 ? "agency worker, Downtown Outreach"
    : a === users.pendingWorker ? "agency worker waiting for approval"
    : a === users.applicant ? "applied for a new partner, waiting for verification"
    : a === users.oshawaWorker ? "agency worker, Harbour Outreach"
    : "neighbour";
  for (const a of all) console.log(`  ${DEMO_EMAIL(a)}  (${role(a)})`);
  console.log("  demo-new-neighbour@example.test  (neighbour with no claims yet)");
  setDb(undefined);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
