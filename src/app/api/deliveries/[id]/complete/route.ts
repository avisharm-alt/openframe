import { userRoute } from "@/lib/http";
import { completeDelivery } from "@/lib/services/deliveries";

// An assigned volunteer, or a coordinator of the chapter.
export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => {
  completeDelivery(actor, params.id);
  return { ok: true };
});
