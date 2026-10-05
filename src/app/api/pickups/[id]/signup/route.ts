import { userRoute } from "@/lib/http";
import { signUpForSlot } from "@/lib/services/pickups";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => signUpForSlot(actor, params.id));
