import { maintainerRoute } from "@/lib/http";
import { adminUniversities, createCourse, listAdminCourses } from "@/lib/services/catalog-admin";

export const GET = maintainerRoute({}, ({ actor }) => ({ courses: listAdminCourses(actor), universities: adminUniversities(actor) }));
export const POST = maintainerRoute({ body: true }, ({ actor, body }) => createCourse(actor, body));
