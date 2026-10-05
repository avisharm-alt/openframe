import { userRoute } from "@/lib/http";
import { updateSlot } from "@/lib/services/shifts";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => ({ slot: updateSlot(actor, params.id, body) }));
