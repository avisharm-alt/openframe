import { userRoute } from "@/lib/http";
import { fileConcern } from "@/lib/services/concerns";

export const POST = userRoute({ body: true }, ({ actor, body }) => fileConcern(actor, body));
