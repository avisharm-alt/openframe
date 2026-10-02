import { publicRoute } from "@/lib/http";
import { finishSession } from "@/lib/services/practice";

export const POST = publicRoute<{ id: string }>({}, ({ actor, params }) => finishSession(params.id, actor));
