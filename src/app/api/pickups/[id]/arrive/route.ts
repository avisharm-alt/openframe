import { userRoute } from "@/lib/http";
import { arrive } from "@/lib/services/pickups";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => arrive(actor, params.id));
