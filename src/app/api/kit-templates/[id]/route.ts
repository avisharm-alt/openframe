import { userRoute } from "@/lib/http";
import { updateKitTemplate } from "@/lib/services/kits";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => ({ template: updateKitTemplate(actor, params.id, body) }));
