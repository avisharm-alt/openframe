import { userRoute } from "@/lib/http";
import { confirmWindow } from "@/lib/services/pickups";

export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => confirmWindow(actor, params.id, body));
