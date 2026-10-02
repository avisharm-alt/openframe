import { maintainerRoute } from "@/lib/http";
import { setCourseRequestStatus } from "@/lib/services/catalog-admin";

export const PATCH = maintainerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => setCourseRequestStatus(actor, params.id, body));
