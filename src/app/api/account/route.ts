import { z } from "zod";
import { userRoute } from "@/lib/http";
import { deleteAccount } from "@/lib/services/account";

const schema = z.strictObject({ confirm: z.literal("DELETE") });

export const DELETE = userRoute({ body: true }, ({ actor, body }) => {
  schema.parse(body);
  return deleteAccount(actor.id);
});
