import { publicRoute } from "@/lib/http";
import { listCourses } from "@/lib/services/catalog";

export const GET = publicRoute({}, ({ req }) => ({ courses: listCourses(new URL(req.url).searchParams.get("q") ?? "") }));
