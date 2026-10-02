import { publicRoute } from "@/lib/http";
import { getCourse } from "@/lib/services/catalog";

export const GET = publicRoute<{ slug: string }>({}, ({ params }) => getCourse(params.slug));
