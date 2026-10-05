import { userRoute } from "@/lib/http";
import { createSite, listSitesFor } from "@/lib/services/partners";

type P = { id: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ sites: listSitesFor(actor, params.id) }));
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ site: createSite(actor, params.id, body) }));
