import { maintainerRoute } from "@/lib/http";
import { addOutline } from "@/lib/services/catalog-admin";

export const POST = maintainerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => addOutline(actor, params.id, body));
