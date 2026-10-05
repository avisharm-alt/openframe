import { userRoute } from "@/lib/http";
import { myDeliveries } from "@/lib/services/deliveries";
import { availableSlots, myAssignments } from "@/lib/services/pickups";
import { safetyAcknowledgedAt } from "@/lib/services/safety";
import { myShifts, openShifts } from "@/lib/services/shifts";

export const GET = userRoute({}, ({ actor }) => ({
  safetyAcknowledgedAt: safetyAcknowledgedAt(actor.id),
  shifts: myShifts(actor),
  openShifts: openShifts(actor),
  assignments: myAssignments(actor),
  slots: availableSlots(actor),
  deliveries: myDeliveries(actor),
}));
