import { headers } from "next/headers";
import { getActor } from "./http";

/** Server-component helper: the signed-in actor (with server-checked role) or null. */
export async function currentActor() {
  return getActor(await headers());
}
