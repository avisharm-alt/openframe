import { publicRoute } from "@/lib/http";
import { getPublicQuestion } from "@/lib/services/catalog";

// Public view only: stem and options, never the key or explanations. 404 unless published.
export const GET = publicRoute<{ id: string }>({}, ({ params }) => getPublicQuestion(params.id));
