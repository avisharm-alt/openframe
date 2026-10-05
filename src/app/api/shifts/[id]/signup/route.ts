import { userRoute } from "@/lib/http";
import { cancelShiftSignup, signUpShift } from "@/lib/services/shifts";

type P = { id: string };
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => {
  signUpShift(actor, params.id, body);
  return { ok: true };
});
export const DELETE = userRoute<P>({}, ({ actor, params, req }) => {
  cancelShiftSignup(actor, params.id, new URL(req.url).searchParams.get("date") ?? "");
  return { ok: true };
});
