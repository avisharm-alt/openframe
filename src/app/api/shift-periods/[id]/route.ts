import { userRoute } from "@/lib/http";
import { deletePeriod } from "@/lib/services/shifts";

export const DELETE = userRoute<{ id: string }>({}, ({ actor, params }) => {
  deletePeriod(actor, params.id);
  return { ok: true };
});
