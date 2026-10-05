import { userRoute } from "@/lib/http";
import { getMyPledge, reschedulePledge } from "@/lib/services/pledges";

type P = { id: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ pledge: getMyPledge(actor, params.id) }));
export const PATCH = userRoute<P>({ body: true }, ({ actor, params, body }) => {
  reschedulePledge(actor, params.id, body);
  return { pledge: getMyPledge(actor, params.id) };
});
