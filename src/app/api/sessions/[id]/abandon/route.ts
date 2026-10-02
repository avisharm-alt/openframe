import { publicRoute } from "@/lib/http";
import { abandonSession } from "@/lib/services/practice";

export const POST = publicRoute<{ id: string }>({}, ({ actor, params }) => abandonSession(params.id, actor));
