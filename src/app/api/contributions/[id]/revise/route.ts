import { userRoute } from "@/lib/http";
import { revise } from "@/lib/services/contributions";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => revise(actor, params.id));
