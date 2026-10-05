import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listIncomingDropoffs } from "@/lib/services/pledges";

export const GET = userRoute<{ slug: string }>({}, ({ actor, params }) => ({ dropoffs: listIncomingDropoffs(actor, getChapterBySlug(params.slug).id) }));
