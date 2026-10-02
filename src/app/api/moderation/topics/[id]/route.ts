import { maintainerRoute } from "@/lib/http";
import { deleteTopic, updateTopic } from "@/lib/services/catalog-admin";

export const PATCH = maintainerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => updateTopic(actor, params.id, body));
export const DELETE = maintainerRoute<{ id: string }>({}, ({ actor, params }) => deleteTopic(actor, params.id));
