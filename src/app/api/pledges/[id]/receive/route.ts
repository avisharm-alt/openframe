import { userRoute } from "@/lib/http";
import { receivePledge } from "@/lib/services/pledges";

// Coordinator of the pledge's chapter only (checked in the service).
export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => receivePledge(actor, params.id, body));
