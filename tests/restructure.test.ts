import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, migrate } from "@/lib/db";
import { freshDb, makeUser } from "./helpers";
import { logAudit } from "@/lib/services/audit";
import { deleteAccount } from "@/lib/services/account";

const dir = path.join(process.cwd(), "migrations");

describe("migration 006: restructure from the question bank", () => {
  it("upgrades a database that holds question-bank data", () => {
    const db = openDb(":memory:");
    db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    for (const f of fs.readdirSync(dir).filter((f) => f < "006").sort()) {
      db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(f);
    }
    db.prepare(`INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,role) VALUES ('m','m','m@x.test',1,'t','t','maintainer'),('r','r','r@x.test',1,'t','t','reviewer'),('s','s','s@x.test',1,'t','t','student')`).run();
    db.prepare("INSERT INTO university (id,slug,name,enabled) VALUES ('u','w','W',1)").run();
    db.prepare("INSERT INTO course (id,university_id,slug,code,title,subject,created_at) VALUES ('c','u','s','C','T','S','t')").run();
    db.prepare("INSERT INTO moderation_event (id,actor_id,action,question_id,detail,created_at) VALUES ('e','m','withdraw','q','{}','t')").run();

    expect(migrate(db)).toEqual(["006_restructure.sql", "007_care_network.sql", "008_seed_reference.sql", "009_partners_requests.sql", "010_seed_requests.sql"]);

    const roles = Object.fromEntries((db.prepare('SELECT id, role FROM "user"').all() as { id: string; role: string }[]).map((r) => [r.id, r.role]));
    expect(roles).toEqual({ m: "admin", r: "member", s: "member" });
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const gone of ["question", "question_revision", "question_option", "practice_session", "attempt", "bookmark", "course", "university", "course_note", "moderation_event", "report"]) {
      expect(tables).not.toContain(gone);
    }
    expect(tables).toContain("audit_event");
    expect(db.prepare("SELECT action FROM audit_event").all()).toEqual([{ action: "withdraw" }]);
    expect((db.prepare("SELECT slug FROM chapter ORDER BY slug").all() as { slug: string }[]).map((c) => c.slug)).toEqual(["london", "oshawa"]);
    expect(migrate(db)).toEqual([]); // idempotent
  });

  it("gives new accounts the member role", () => {
    const db = freshDb();
    db.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run("x", "x", "x@x.test", 0, "t", "t");
    expect((db.prepare('SELECT role FROM "user" WHERE id = ?').get("x") as { role: string }).role).toBe("member");
  });
});

describe("audit_event", () => {
  it("is append-only, but still lets account deletion clear the actor", () => {
    const db = freshDb();
    const u = makeUser(db, "Someone");
    logAudit(u.id, "test_action", { subjectType: "thing", subjectId: "1" });
    expect(() => db.prepare("DELETE FROM audit_event").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE audit_event SET action = 'other'").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE audit_event SET detail = '{\"x\":1}'").run()).toThrow(/append-only/);
    deleteAccount(u.id);
    const rows = db.prepare("SELECT actor_id, action FROM audit_event WHERE action = 'test_action'").all();
    expect(rows).toEqual([{ actor_id: null, action: "test_action" }]);
  });
});
