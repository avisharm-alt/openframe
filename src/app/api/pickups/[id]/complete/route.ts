import { userRoute } from "@/lib/http";
import { completePickup } from "@/lib/services/pickups";

export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => completePickup(actor, params.id, body));
