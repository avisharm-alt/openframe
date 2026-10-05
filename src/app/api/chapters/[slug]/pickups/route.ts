import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { pickupBoard } from "@/lib/services/pickups";

// Cards describe each pickup (windows, volunteers, overdue flag). They never include the address.
export const GET = userRoute<{ slug: string }>({}, ({ actor, params }) => ({ board: pickupBoard(actor, getChapterBySlug(params.slug).id) }));
