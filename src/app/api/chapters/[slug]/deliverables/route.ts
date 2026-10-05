import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listDeliverables } from "@/lib/services/deliveries";

export const GET = userRoute<{ slug: string }>({}, ({ actor, params }) => ({ deliverables: listDeliverables(actor, getChapterBySlug(params.slug).id) }));
