import { userRoute } from "@/lib/http";
import { updateSite } from "@/lib/services/partners";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => ({ site: updateSite(actor, params.id, body) }));
