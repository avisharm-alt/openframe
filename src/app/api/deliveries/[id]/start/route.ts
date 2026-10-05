import { userRoute } from "@/lib/http";
import { startDelivery } from "@/lib/services/deliveries";

// An assigned volunteer, or a coordinator of the chapter.
export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => {
  startDelivery(actor, params.id);
  return { ok: true };
});
