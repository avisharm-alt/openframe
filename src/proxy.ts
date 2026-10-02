import { NextResponse, type NextRequest } from "next/server";
import { guardRequest } from "@/lib/guard";

export function proxy(req: NextRequest) {
  const bad = guardRequest(req, {
    baseUrl: process.env.BASE_URL || "http://localhost:3000",
    trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
  });
  if (bad) return NextResponse.json({ error: { code: bad.code, message: bad.message } }, { status: bad.status });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
