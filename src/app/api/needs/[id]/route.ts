import { userRoute } from "@/lib/http";
import { updateNeed } from "@/lib/services/needs";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => ({ need: updateNeed(actor, params.id, body) }));
