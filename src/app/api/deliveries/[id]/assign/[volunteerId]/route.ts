import { userRoute } from "@/lib/http";
import { removeDeliveryVolunteer } from "@/lib/services/deliveries";

export const DELETE = userRoute<{ id: string; volunteerId: string }>({}, ({ actor, params }) => {
  removeDeliveryVolunteer(actor, params.id, params.volunteerId);
  return { ok: true };
});
