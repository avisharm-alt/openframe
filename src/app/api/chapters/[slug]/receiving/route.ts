import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listAwaitingReceipt } from "@/lib/services/pledges";

export const GET = userRoute<{ slug: string }>({}, ({ actor, params }) => ({ pledges: listAwaitingReceipt(actor, getChapterBySlug(params.slug).id) }));
