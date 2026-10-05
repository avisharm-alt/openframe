// Request guard applied to every /api request (via src/proxy.ts and again in apiHandler).
// - Accepts structured JSON only: no multipart, no file uploads, and no recipient photos or documents.
// - Caps body size.
// - Blocks cross-origin state-changing requests (CSRF defence in depth on top of SameSite=Lax cookies).

export type GuardResult = { status: number; code: string; message: string } | null;

const MAX_BODY_BYTES = 100_000;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function guardRequest(req: Request, opts: { baseUrl: string; trustProxy: boolean }): GuardResult {
  if (!MUTATING.has(req.method)) return null;
  const h = req.headers;
  const ct = (h.get("content-type") || "").toLowerCase();
  const len = Number(h.get("content-length") || "0");
  const hasBody = len > 0 || h.has("transfer-encoding");

  if (ct.startsWith("multipart/") || ct.startsWith("application/octet-stream") || /^(image|video|audio)\//.test(ct)) {
    return { status: 415, code: "uploads_not_supported", message: "File uploads are not supported. Submit structured text only." };
  }
  if (hasBody && !ct.startsWith("application/json")) {
    return { status: 415, code: "unsupported_media_type", message: "Only application/json request bodies are accepted." };
  }
  if (len > MAX_BODY_BYTES) {
    return { status: 413, code: "too_large", message: "Request body is too large." };
  }

  const origin = h.get("origin");
  if (origin) {
    let ok = false;
    try {
      const o = new URL(origin);
      const host = (opts.trustProxy && h.get("x-forwarded-host")) || h.get("host");
      ok = o.origin === new URL(opts.baseUrl).origin || (!!host && o.host === host);
    } catch {
      ok = false;
    }
    if (!ok) return { status: 403, code: "bad_origin", message: "Cross-origin request rejected." };
  }
  return null;
}
