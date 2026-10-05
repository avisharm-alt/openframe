import { publicRoute } from "@/lib/http";
import { getImpact } from "@/lib/services/impact";

export const GET = publicRoute({}, () => ({ chapters: getImpact() }));
