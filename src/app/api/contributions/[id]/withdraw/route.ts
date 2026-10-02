import { userRoute } from "@/lib/http";
import { withdrawOwn } from "@/lib/services/contributions";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => withdrawOwn(actor, params.id));
