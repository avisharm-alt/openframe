import { publicRoute } from "@/lib/http";
import { deleteSession, getSessionState } from "@/lib/services/practice";

export const GET = publicRoute<{ id: string }>({}, ({ actor, params }) => getSessionState(params.id, actor));
export const DELETE = publicRoute<{ id: string }>({}, ({ actor, params }) => deleteSession(params.id, actor));
