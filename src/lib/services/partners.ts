import { getDb, now, uid } from "../db";
import { notFound } from "../errors";
import { partnerPatchSchema, partnerSchema } from "../validation";
import type { Actor } from "../types";
import { logAudit } from "./audit";
import { requireCoordinator } from "./access";

export type Partner = { id: string; chapterId: string; name: string; description: string; acceptsPackages: boolean; active: boolean };
type PartnerRow = { id: string; chapter_id: string; name: string; description: string; accepts_packages: number; active: number };
const toPartner = (r: PartnerRow): Partner => ({ id: r.id, chapterId: r.chapter_id, name: r.name, description: r.description, acceptsPackages: !!r.accepts_packages, active: !!r.active });

export function listPartners(chapterId: string, opts: { activeOnly?: boolean } = {}): Partner[] {
  const rows = getDb().prepare(`SELECT * FROM partner_agency WHERE chapter_id = ? ${opts.activeOnly ? "AND active = 1" : ""} ORDER BY name`).all(chapterId) as PartnerRow[];
  return rows.map(toPartner);
}
export function getPartner(id: string): Partner {
  const r = getDb().prepare("SELECT * FROM partner_agency WHERE id = ?").get(id) as PartnerRow | undefined;
  if (!r) throw notFound("Partner agency not found");
  return toPartner(r);
}
export function createPartner(actor: Actor, chapterId: string, raw: unknown): Partner {
  requireCoordinator(actor, chapterId);
  const input = partnerSchema.parse(raw);
  const id = uid();
  getDb()
    .prepare("INSERT INTO partner_agency (id, chapter_id, name, description, accepts_packages, active, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, chapterId, input.name, input.description, input.acceptsPackages ? 1 : 0, input.active ? 1 : 0, now());
  logAudit(actor.id, "partner_created", { chapterId, subjectType: "partner", subjectId: id });
  return getPartner(id);
}
export function updatePartner(actor: Actor, partnerId: string, raw: unknown): Partner {
  const p = getPartner(partnerId);
  requireCoordinator(actor, p.chapterId);
  const x = partnerPatchSchema.parse(raw);
  getDb()
    .prepare("UPDATE partner_agency SET name = ?, description = ?, accepts_packages = ?, active = ? WHERE id = ?")
    .run(x.name ?? p.name, x.description ?? p.description, (x.acceptsPackages ?? p.acceptsPackages) ? 1 : 0, (x.active ?? p.active) ? 1 : 0, partnerId);
  logAudit(actor.id, "partner_updated", { chapterId: p.chapterId, subjectType: "partner", subjectId: partnerId });
  return getPartner(partnerId);
}
