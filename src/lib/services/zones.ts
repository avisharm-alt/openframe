import { getDb, now, uid } from "../db";
import { notFound } from "../errors";
import { zonePatchSchema, zoneSchema } from "../validation";
import type { Actor } from "../types";
import { logAudit } from "./audit";
import { requireCoordinator } from "./access";

export type Zone = { id: string; chapterId: string; name: string; description: string; hours: string; active: boolean };
type ZoneRow = { id: string; chapter_id: string; name: string; description: string; hours: string; active: number };
const toZone = (r: ZoneRow): Zone => ({ id: r.id, chapterId: r.chapter_id, name: r.name, description: r.description, hours: r.hours, active: !!r.active });

export function listZones(chapterId: string, opts: { activeOnly?: boolean } = {}): Zone[] {
  const rows = getDb()
    .prepare(`SELECT * FROM zone WHERE chapter_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY name`)
    .all(chapterId) as ZoneRow[];
  return rows.map(toZone);
}
export function getZone(id: string): Zone {
  const r = getDb().prepare("SELECT * FROM zone WHERE id = ?").get(id) as ZoneRow | undefined;
  if (!r) throw notFound("Drop-off zone not found");
  return toZone(r);
}

export function createZone(actor: Actor, chapterId: string, raw: unknown): Zone {
  requireCoordinator(actor, chapterId);
  const input = zoneSchema.parse(raw);
  const id = uid();
  getDb().prepare("INSERT INTO zone (id, chapter_id, name, description, hours, active, created_at) VALUES (?,?,?,?,?,?,?)").run(id, chapterId, input.name, input.description, input.hours, input.active ? 1 : 0, now());
  logAudit(actor.id, "zone_created", { chapterId, subjectType: "zone", subjectId: id });
  return getZone(id);
}
export function updateZone(actor: Actor, zoneId: string, raw: unknown): Zone {
  const z = getZone(zoneId);
  requireCoordinator(actor, z.chapterId);
  const p = zonePatchSchema.parse(raw);
  getDb()
    .prepare("UPDATE zone SET name = ?, description = ?, hours = ?, active = ? WHERE id = ?")
    .run(p.name ?? z.name, p.description ?? z.description, p.hours ?? z.hours, (p.active ?? z.active) ? 1 : 0, zoneId);
  logAudit(actor.id, "zone_updated", { chapterId: z.chapterId, subjectType: "zone", subjectId: zoneId });
  return getZone(zoneId);
}
