import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listRequests } from "@/lib/services/requests";

// The triage view: live requests, at-risk ones first.
export const GET = userRoute<{ slug: string }>({}, ({ actor, params }) => ({ requests: listRequests(actor, getChapterBySlug(params.slug).id) }));
