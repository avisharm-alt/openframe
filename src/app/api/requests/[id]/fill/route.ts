import { userRoute } from "@/lib/http";
import { fillFromStock } from "@/lib/services/requests";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => fillFromStock(actor, params.id));
