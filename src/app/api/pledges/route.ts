import { userRoute } from "@/lib/http";
import { createPledge, listMyPledges } from "@/lib/services/pledges";

export const GET = userRoute({}, ({ actor }) => ({ pledges: listMyPledges(actor) }));
export const POST = userRoute({ body: true }, ({ actor, body }) => createPledge(actor, body));
