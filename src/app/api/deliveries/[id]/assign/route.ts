import { userRoute } from "@/lib/http";
import { assignDeliveryVolunteer } from "@/lib/services/deliveries";

export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  assignDeliveryVolunteer(actor, params.id, body);
  return { ok: true };
});
