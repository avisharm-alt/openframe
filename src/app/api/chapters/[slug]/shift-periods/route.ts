import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { createPeriod } from "@/lib/services/shifts";

export const POST = userRoute<{ slug: string }>({ body: true }, ({ actor, params, body }) => createPeriod(actor, getChapterBySlug(params.slug).id, body));
