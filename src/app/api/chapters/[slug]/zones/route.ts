import { userRoute } from "@/lib/http";
import { getChapterBySlug, requireCoordinator } from "@/lib/services/access";
import { createZone, listZones } from "@/lib/services/zones";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => {
  const c = getChapterBySlug(params.slug);
  requireCoordinator(actor, c.id);
  return { zones: listZones(c.id) };
});
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ zone: createZone(actor, getChapterBySlug(params.slug).id, body) }));
