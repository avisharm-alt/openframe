import { userRoute } from "@/lib/http";
import { lastRequest } from "@/lib/services/requests";

export const GET = userRoute<{ id: string }>({}, ({ actor, params }) => ({ last: lastRequest(actor, params.id) }));
