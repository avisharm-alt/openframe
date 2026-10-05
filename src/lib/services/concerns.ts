import { getDb, now, uid } from "../db";
import { conflict, notFound } from "../errors";
import { rateLimit } from "../ratelimit";
import { concernSchema, concernUpdateSchema } from "../validation";
import type { Actor, ConcernCategory } from "../types";
import { logAudit } from "./audit";
import { requireCoordinator } from "./access";
import { loadPledge } from "./pledges";

const PRIORITY: Record<ConcernCategory, number> = { safety: 2, conduct: 1, no_show: 0, other: 0 };

/** Inserts a concern. Used by fileConcern and, for safety concerns raised at check-out, by pickups.ts. */
export function insertConcern(e: { chapterId: string; pledgeId: string | null; reporterId: string | null; reporterRole: "donor" | "volunteer"; category: ConcernCategory; details: string }) {
  const id = uid();
  getDb()
    .prepare("INSERT INTO concern_report (id, chapter_id, pledge_id, reporter_id, reporter_role, category, details, priority, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'open',?,?)")
    .run(id, e.chapterId, e.pledgeId, e.reporterId, e.reporterRole, e.category, e.details, PRIORITY[e.category], now(), now());
  logAudit(e.reporterId, "concern_filed", { chapterId: e.chapterId, subjectType: "concern", subjectId: id, detail: { category: e.category, by: e.reporterRole } });
  return id;
}

/**
 * A donor can report a concern about the volunteers on their pickup, and an assigned volunteer can report a concern
 * about the donor. Reports go to the chapter's coordinator queue. Nobody else can report on a pledge.
 */
export function fileConcern(actor: Actor, raw: unknown): { id: string } {
  rateLimit(`concern:${actor.id}`, 5, 3600_000);
  const input = concernSchema.parse(raw);
  const p = loadPledge(input.pledgeId);
  const db = getDb();
  const pk = db.prepare("SELECT id FROM pickup WHERE pledge_id = ?").get(p.id) as { id: string } | undefined;
  let role: "donor" | "volunteer" | null = null;
  if (pk && p.donor_id === actor.id) role = "donor";
  else if (pk && db.prepare("SELECT 1 FROM pickup_assignment WHERE pickup_id = ? AND volunteer_id = ?").get(pk.id, actor.id)) role = "volunteer";
  if (!role) throw notFound("Pledge not found");
  if (role === "donor" && p.status === "pledged" && !db.prepare("SELECT 1 FROM pickup_assignment WHERE pickup_id = ?").get(pk!.id)) {
    throw conflict("no_volunteers_yet", "No volunteers have been assigned to this pickup yet.");
  }
  return { id: insertConcern({ chapterId: p.chapter_id, pledgeId: p.id, reporterId: actor.id, reporterRole: role, category: input.category, details: input.details }) };
}

export type ConcernRow = {
  id: string; pledgeId: string | null; reporterRole: "donor" | "volunteer"; category: ConcernCategory; details: string; priority: number;
  state: string; resolutionNote: string | null; createdAt: string; donorName: string | null; volunteers: string[];
};

/** The coordinator queue: safety concerns first, then newest. */
export function listConcerns(actor: Actor, chapterId: string, state?: string): ConcernRow[] {
  requireCoordinator(actor, chapterId);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.pledge_id AS pledgeId, c.reporter_role AS reporterRole, c.category, c.details, c.priority, c.state, c.resolution_note AS resolutionNote,
              c.created_at AS createdAt, u.name AS donorName
         FROM concern_report c LEFT JOIN pledge p ON p.id = c.pledge_id LEFT JOIN "user" u ON u.id = p.donor_id
        WHERE c.chapter_id = ? ${state ? "AND c.state = ?" : ""} ORDER BY (c.state IN ('open','investigating')) DESC, c.priority DESC, c.created_at DESC LIMIT 200`,
    )
    .all(...(state ? [chapterId, state] : [chapterId])) as Omit<ConcernRow, "volunteers">[];
  return rows.map((r) => ({
    ...r,
    volunteers: r.pledgeId
      ? (db.prepare("SELECT u.name FROM pickup_assignment a JOIN pickup k ON k.id = a.pickup_id JOIN \"user\" u ON u.id = a.volunteer_id WHERE k.pledge_id = ? ORDER BY a.assigned_at, a.rowid").all(r.pledgeId) as { name: string }[]).map((v) => v.name)
      : [],
  }));
}

export function updateConcern(actor: Actor, concernId: string, raw: unknown) {
  const c = getDb().prepare("SELECT chapter_id AS chapterId FROM concern_report WHERE id = ?").get(concernId) as { chapterId: string } | undefined;
  if (!c) throw notFound("Report not found");
  requireCoordinator(actor, c.chapterId);
  const input = concernUpdateSchema.parse(raw);
  getDb().prepare("UPDATE concern_report SET state = ?, resolution_note = ?, handled_by = ?, updated_at = ? WHERE id = ?").run(input.state, input.resolutionNote || null, actor.id, now(), concernId);
  logAudit(actor.id, "concern_updated", { chapterId: c.chapterId, subjectType: "concern", subjectId: concernId, detail: { state: input.state } });
}
