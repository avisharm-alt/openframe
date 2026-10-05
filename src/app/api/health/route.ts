import { publicRoute } from "@/lib/http";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Liveness/readiness for the hosting platform: confirms the process is up, the database opens (which also applies
// pending migrations) and the pickup encryption key is configured (it throws in production if it is missing, so a
// misconfigured deploy fails its health check instead of failing the first pledge). Reveals nothing else.
export const GET = publicRoute({}, () => {
  getDb().prepare("SELECT 1").get();
  void config.pickupEncryptionSecret;
  return { status: "ok" };
});
