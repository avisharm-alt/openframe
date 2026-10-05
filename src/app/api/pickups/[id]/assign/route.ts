import { userRoute } from "@/lib/http";
import { assignVolunteer } from "@/lib/services/pickups";

export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => assignVolunteer(actor, params.id, body));
