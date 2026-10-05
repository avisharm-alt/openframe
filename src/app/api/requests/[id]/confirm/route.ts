import { userRoute } from "@/lib/http";
import { confirmReceipt } from "@/lib/services/deliveries";

// The agency worker confirms receipt (or a coordinator records it).
export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => {
  confirmReceipt(actor, params.id);
  return { ok: true };
});
