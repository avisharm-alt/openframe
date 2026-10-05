import { userRoute } from "@/lib/http";
import { updateTemplate } from "@/lib/services/templates";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => ({ template: updateTemplate(actor, params.id, body) }));
