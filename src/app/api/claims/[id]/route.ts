import { userRoute } from "@/lib/http";
import { getMyClaim, rescheduleClaim } from "@/lib/services/claims";

type P = { id: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ claim: getMyClaim(actor, params.id) }));
export const PATCH = userRoute<P>({ body: true }, ({ actor, params, body }) => {
  rescheduleClaim(actor, params.id, body);
  return { claim: getMyClaim(actor, params.id) };
});
