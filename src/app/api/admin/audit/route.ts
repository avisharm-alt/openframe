import { adminRoute } from "@/lib/http";
import { listAudit } from "@/lib/services/audit";

export const GET = adminRoute({}, ({ actor, req }) => {
  const u = new URL(req.url).searchParams;
  return { events: listAudit(actor, { action: u.get("action") ?? undefined, limit: Number(u.get("limit") || 100) }) };
});
