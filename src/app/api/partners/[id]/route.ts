import { userRoute } from "@/lib/http";
import { updatePartner } from "@/lib/services/partners";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => ({ partner: updatePartner(actor, params.id, body) }));
