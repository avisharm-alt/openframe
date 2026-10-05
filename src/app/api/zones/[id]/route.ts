import { userRoute } from "@/lib/http";
import { updateZone } from "@/lib/services/zones";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => ({ zone: updateZone(actor, params.id, body) }));
