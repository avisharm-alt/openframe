import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listApprovals } from "@/lib/services/partners";

export const GET = userRoute<{ slug: string }>({}, ({ actor, params }) => ({ approvals: listApprovals(actor, getChapterBySlug(params.slug).id) }));
