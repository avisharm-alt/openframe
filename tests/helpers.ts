import { openDb, migrate, setDb, uid, now, type DB } from "@/lib/db";
import { setClock } from "@/lib/time";
import { resetRateLimits } from "@/lib/ratelimit";
import type { Actor, Role } from "@/lib/types";

/** A fresh in-memory database with every migration applied (including the seeded catalog and both chapters). */
export function freshDb(): DB {
  const db = openDb(":memory:");
  migrate(db);
  setDb(db);
  setClock(null);
  resetRateLimits();
  return db;
}

export function makeUser(db: DB, name: string, role: Role = "member"): Actor {
  const id = uid();
  db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?,?,?,?,?,?,?)').run(
    id, name, `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`, 0, now(), now(), role,
  );
  return { id, role, name };
}
