import { maintainerRoute } from "@/lib/http";
import { deleteCourse, getAdminCourse, updateCourse } from "@/lib/services/catalog-admin";

export const GET = maintainerRoute<{ id: string }>({}, ({ actor, params }) => getAdminCourse(actor, params.id));
export const PATCH = maintainerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => updateCourse(actor, params.id, body));
export const DELETE = maintainerRoute<{ id: string }>({}, ({ actor, params }) => deleteCourse(actor, params.id));
