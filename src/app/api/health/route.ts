import { publicRoute } from "@/lib/http";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Liveness/readiness for the hosting platform: confirms the process is up and the database opens
// (which also applies pending migrations). Reveals nothing else.
export const GET = publicRoute({}, () => {
  getDb().prepare("SELECT 1").get();
  return { status: "ok" };
});
