import { publicRoute } from "@/lib/http";

export const GET = publicRoute({}, ({ actor }) => ({ user: actor ? { id: actor.id, name: actor.name, role: actor.role } : null }));
