import { userRoute } from "@/lib/http";
import { acknowledgeSafety } from "@/lib/services/safety";

export const POST = userRoute({}, ({ actor }) => acknowledgeSafety(actor));
