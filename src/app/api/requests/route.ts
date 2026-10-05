import { userRoute } from "@/lib/http";
import { createRequest } from "@/lib/services/requests";

export const POST = userRoute({ body: true }, ({ actor, body }) => createRequest(actor, body));
