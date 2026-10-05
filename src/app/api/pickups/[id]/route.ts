import { userRoute } from "@/lib/http";
import { viewPickupDetails } from "@/lib/services/pickups";

// The ONLY endpoint that returns a pickup address, notes and phone. Every call is checked (neighbour, chapter
// coordinator or assigned volunteer, inside the visibility window) and written to the audit log.
export const GET = userRoute<{ id: string }>({}, ({ actor, params }) => ({ details: viewPickupDetails(actor, params.id) }));
