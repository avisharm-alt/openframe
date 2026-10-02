import { maintainerRoute } from "@/lib/http";
import { deleteUnit, updateUnit } from "@/lib/services/catalog-admin";

export const PATCH = maintainerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => updateUnit(actor, params.id, body));
export const DELETE = maintainerRoute<{ id: string }>({}, ({ actor, params }) => deleteUnit(actor, params.id));
