import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { createPartner, listPartnersAdmin } from "@/lib/services/partners";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ partners: listPartnersAdmin(actor, getChapterBySlug(params.slug).id) }));
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ partner: createPartner(actor, getChapterBySlug(params.slug).id, body) }));
