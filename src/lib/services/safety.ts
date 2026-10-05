import { getDb, now } from "../db";
import type { Actor } from "../types";
import { logAudit } from "./audit";

/** Bump this when the Safety page changes materially: volunteers then have to acknowledge it again. */
export const SAFETY_VERSION = 1;

export function acknowledgeSafety(actor: Actor): { acknowledgedAt: string } {
  const at = now();
  getDb().prepare("INSERT INTO safety_ack (user_id, version, acknowledged_at) VALUES (?,?,?) ON CONFLICT (user_id, version) DO NOTHING").run(actor.id, SAFETY_VERSION, at);
  logAudit(actor.id, "safety_acknowledged", { subjectType: "user", subjectId: actor.id, detail: { version: SAFETY_VERSION } });
  return { acknowledgedAt: safetyAcknowledgedAt(actor.id) ?? at };
}
export function safetyAcknowledgedAt(userId: string): string | null {
  const r = getDb().prepare("SELECT acknowledged_at AS at FROM safety_ack WHERE user_id = ? AND version >= ? ORDER BY version DESC LIMIT 1").get(userId, SAFETY_VERSION) as { at: string } | undefined;
  return r?.at ?? null;
}
