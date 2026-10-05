import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { handOffPackages } from "@/lib/services/packages";

export const POST = userRoute<{ slug: string }>({ body: true }, ({ actor, params, body }) => handOffPackages(actor, getChapterBySlug(params.slug).id, body));
