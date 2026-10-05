import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { assemblePackages, listAssemblable, listPackages } from "@/lib/services/packages";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => {
  const id = getChapterBySlug(params.slug).id;
  return { assemblable: listAssemblable(actor, id), packages: listPackages(actor, id) };
});
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => assemblePackages(actor, getChapterBySlug(params.slug).id, body));
