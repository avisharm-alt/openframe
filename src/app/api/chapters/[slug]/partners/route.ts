import { userRoute } from "@/lib/http";
import { getChapterBySlug, requireCoordinator } from "@/lib/services/access";
import { createPartner, listPartners } from "@/lib/services/partners";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => {
  const c = getChapterBySlug(params.slug);
  requireCoordinator(actor, c.id);
  return { partners: listPartners(c.id) };
});
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ partner: createPartner(actor, getChapterBySlug(params.slug).id, body) }));
