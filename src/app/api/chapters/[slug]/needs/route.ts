import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { createNeed, listNeeds } from "@/lib/services/needs";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ needs: listNeeds(actor, getChapterBySlug(params.slug).id) }));
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ need: createNeed(actor, getChapterBySlug(params.slug).id, body) }));
