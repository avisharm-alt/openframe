import { userRoute } from "@/lib/http";
import { listPartnerMemberships } from "@/lib/services/access";

export const GET = userRoute({}, ({ actor }) => ({ partners: listPartnerMemberships(actor.id) }));
