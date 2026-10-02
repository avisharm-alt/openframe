import { maintainerRoute } from "@/lib/http";
import { createTopic } from "@/lib/services/catalog-admin";

export const POST = maintainerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => createTopic(actor, params.id, body));
