import { maintainerRoute } from "@/lib/http";
import { createUnit } from "@/lib/services/catalog-admin";

export const POST = maintainerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => createUnit(actor, params.id, body));
