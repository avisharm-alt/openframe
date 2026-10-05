import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { assembleKits, listAssemblable } from "@/lib/services/kits";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ assemblable: listAssemblable(actor, getChapterBySlug(params.slug).id) }));
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => assembleKits(actor, getChapterBySlug(params.slug).id, body));
