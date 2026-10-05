import { userRoute } from "@/lib/http";
import { listPartnerRequests } from "@/lib/services/requests";

// A partner's own requests, for its approved workers (and the chapter's coordinators). Nobody else.
export const GET = userRoute<{ id: string }>({}, ({ actor, params }) => ({ requests: listPartnerRequests(actor, params.id) }));
