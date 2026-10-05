import { userRoute } from "@/lib/http";
import { deleteFavourite } from "@/lib/services/requests";

export const DELETE = userRoute<{ id: string }>({}, ({ actor, params }) => {
  deleteFavourite(actor, params.id);
  return { ok: true };
});
