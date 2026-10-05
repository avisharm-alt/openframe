import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listAwaitingReceipt } from "@/lib/services/claims";

export const GET = userRoute<{ slug: string }>({}, ({ actor, params }) => ({ claims: listAwaitingReceipt(actor, getChapterBySlug(params.slug).id) }));
