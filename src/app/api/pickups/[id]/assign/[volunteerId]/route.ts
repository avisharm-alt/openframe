import { userRoute } from "@/lib/http";
import { unassignVolunteer } from "@/lib/services/pickups";

export const DELETE = userRoute<{ id: string; volunteerId: string }>({}, ({ actor, params }) => {
  unassignVolunteer(actor, params.id, params.volunteerId);
  return { ok: true };
});
