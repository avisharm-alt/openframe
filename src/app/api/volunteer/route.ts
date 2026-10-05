import { userRoute } from "@/lib/http";
import { availableSlots, myAssignments } from "@/lib/services/pickups";
import { safetyAcknowledgedAt } from "@/lib/services/safety";

export const GET = userRoute({}, ({ actor }) => ({
  safetyAcknowledgedAt: safetyAcknowledgedAt(actor.id),
  assignments: myAssignments(actor),
  slots: availableSlots(actor),
}));
