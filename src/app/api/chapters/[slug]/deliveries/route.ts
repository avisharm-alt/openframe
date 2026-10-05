import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { createDelivery, listDeliveries } from "@/lib/services/deliveries";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ deliveries: listDeliveries(actor, getChapterBySlug(params.slug).id) }));
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => createDelivery(actor, getChapterBySlug(params.slug).id, body));
