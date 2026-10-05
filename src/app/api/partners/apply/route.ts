import { userRoute } from "@/lib/http";
import { applyPartner } from "@/lib/services/partners";

export const POST = userRoute({ body: true }, ({ actor, body }) => ({ partner: applyPartner(actor, body) }));
