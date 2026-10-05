import { userRoute } from "@/lib/http";
import { receiveClaim } from "@/lib/services/claims";

// Coordinator of the claim's chapter only (checked in the service).
export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => receiveClaim(actor, params.id, body));
