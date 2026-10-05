import { userRoute } from "@/lib/http";
import { getChapterBySlug, requireCoordinator } from "@/lib/services/access";
import { createTemplate, listTemplates } from "@/lib/services/templates";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => {
  const c = getChapterBySlug(params.slug);
  requireCoordinator(actor, c.id);
  return { templates: listTemplates(c.id) };
});
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ template: createTemplate(actor, getChapterBySlug(params.slug).id, body) }));
