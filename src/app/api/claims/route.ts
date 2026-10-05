import { userRoute } from "@/lib/http";
import { createClaim, listMyClaims } from "@/lib/services/claims";

export const GET = userRoute({}, ({ actor }) => ({ claims: listMyClaims(actor) }));
export const POST = userRoute({ body: true }, ({ actor, body }) => createClaim(actor, body));
