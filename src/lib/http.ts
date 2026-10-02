import { NextResponse } from "next/server";
import { ZodError } from "zod";
import crypto from "node:crypto";
import { guardRequest } from "./guard";
import { config } from "./config";
import { ServiceError, forbidden } from "./errors";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { isReviewer, type Actor, type Role } from "./types";

export async function getActor(headers: Headers): Promise<Actor | null> {
  const s = await getAuth().api.getSession({ headers });
  if (!s) return null;
  const row = getDb().prepare('SELECT id, name, role FROM "user" WHERE id = ?').get(s.user.id) as
    | { id: string; name: string; role: string | null }
    | undefined;
  if (!row) return null;
  const role = (["student", "reviewer", "maintainer"].includes(row.role ?? "") ? row.role : "student") as Role;
  return { id: row.id, name: row.name, role };
}

export function clientIp(req: Request): string {
  if (config.trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  return "local";
}

export function ipHash(req: Request): string {
  return crypto.createHmac("sha256", config.authSecret).update(clientIp(req)).digest("hex").slice(0, 32);
}

export function errorResponse(e: unknown) {
  if (e instanceof ServiceError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "invalid",
          message: "Some fields are invalid.",
          details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 422 },
    );
  }
  console.error(e);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong." } }, { status: 500 });
}

type Level = "none" | "user" | "reviewer";
type Opts = { body?: boolean };
type Ctx<P, A> = { req: Request; actor: A; params: P; body: unknown };

function build<P, A extends Actor | null>(level: Level, opts: Opts, fn: (ctx: Ctx<P, A>) => Promise<unknown> | unknown) {
  return async (req: Request, c: { params: Promise<P> }): Promise<Response> => {
    try {
      const bad = guardRequest(req, { baseUrl: config.baseUrl, trustProxy: config.trustProxy });
      if (bad) return NextResponse.json({ error: { code: bad.code, message: bad.message } }, { status: bad.status });
      const actor = await getActor(req.headers);
      if (level !== "none" && !actor) throw new ServiceError(401, "unauthenticated", "Please sign in to continue.");
      if (level === "reviewer" && !isReviewer(actor)) throw forbidden("Reviewer access required.");
      let body: unknown = undefined;
      if (opts.body) {
        const text = await req.text();
        if (text.length > 100_000) throw new ServiceError(413, "too_large", "Request body is too large.");
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          throw new ServiceError(400, "bad_json", "Request body must be valid JSON.");
        }
      }
      const params = await c.params;
      const result = await fn({ req, actor: actor as A, params, body });
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Public route: actor may be null (guest). */
export const publicRoute = <P = Record<string, string>>(opts: Opts, fn: (ctx: Ctx<P, Actor | null>) => Promise<unknown> | unknown) =>
  build<P, Actor | null>("none", opts, fn);
/** Requires a signed-in user. */
export const userRoute = <P = Record<string, string>>(opts: Opts, fn: (ctx: Ctx<P, Actor>) => Promise<unknown> | unknown) =>
  build<P, Actor>("user", opts, fn);
/** Requires reviewer or maintainer role (enforced server-side on every call). */
export const reviewerRoute = <P = Record<string, string>>(opts: Opts, fn: (ctx: Ctx<P, Actor>) => Promise<unknown> | unknown) =>
  build<P, Actor>("reviewer", opts, fn);
