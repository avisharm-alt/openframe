import { userRoute } from "@/lib/http";
import { getChapterBySlug, requireCoordinator } from "@/lib/services/access";
import { createKitTemplate, listKitTemplates } from "@/lib/services/kits";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => {
  const c = getChapterBySlug(params.slug);
  requireCoordinator(actor, c.id);
  return { templates: listKitTemplates(c.id) };
});
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ template: createKitTemplate(actor, getChapterBySlug(params.slug).id, body) }));
