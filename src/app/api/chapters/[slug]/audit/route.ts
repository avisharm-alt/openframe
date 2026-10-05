import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listAudit } from "@/lib/services/audit";

export const GET = userRoute<{ slug: string }>({}, ({ actor, req, params }) => {
  const u = new URL(req.url).searchParams;
  return { events: listAudit(actor, { chapterId: getChapterBySlug(params.slug).id, action: u.get("action") ?? undefined, limit: Number(u.get("limit") || 100) }) };
});
