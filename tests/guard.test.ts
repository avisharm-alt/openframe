import { describe, expect, it } from "vitest";
import { guardRequest } from "@/lib/guard";
import { rateLimit, resetRateLimits } from "@/lib/ratelimit";

const opts = { baseUrl: "http://localhost:3000", trustProxy: false };
const req = (init: RequestInit & { url?: string }) => new Request(init.url ?? "http://localhost:3000/api/contributions", init);

describe("request guard", () => {
  it("rejects multipart and other non-JSON bodies (no file uploads)", () => {
    const body = new FormData();
    body.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "exam.pdf");
    expect(guardRequest(req({ method: "POST", body }), opts)?.code).toBe("uploads_not_supported");
    expect(guardRequest(req({ method: "POST", headers: { "content-type": "application/pdf", "content-length": "10" }, body: "x".repeat(10) }), opts)?.status).toBe(415);
    expect(guardRequest(req({ method: "PUT", headers: { "content-type": "image/png" } }), opts)?.code).toBe("uploads_not_supported");
    expect(guardRequest(req({ method: "POST", headers: { "content-type": "text/plain", "content-length": "4" }, body: "text" }), opts)?.code).toBe("unsupported_media_type");
  });
  it("allows JSON and rejects oversized bodies and cross-origin writes", () => {
    const json = { "content-type": "application/json", "content-length": "2" };
    expect(guardRequest(req({ method: "POST", headers: json, body: "{}" }), opts)).toBeNull();
    expect(guardRequest(req({ method: "POST", headers: { ...json, "content-length": "999999" } }), opts)?.status).toBe(413);
    expect(guardRequest(req({ method: "POST", headers: { ...json, origin: "https://evil.example" }, body: "{}" }), opts)?.code).toBe("bad_origin");
    expect(guardRequest(req({ method: "POST", headers: { ...json, origin: "http://localhost:3000" }, body: "{}" }), opts)).toBeNull();
    expect(guardRequest(req({ method: "GET", headers: { origin: "https://evil.example" } }), opts)).toBeNull();
  });
});

describe("upload exception", () => {
  const mp = { "content-type": "multipart/form-data; boundary=xyz" };
  const notes = (init: RequestInit & { url?: string }) => req({ url: "http://localhost:3000/api/notes", ...init });
  it("allows multipart only for POST /api/notes, within its size cap", () => {
    expect(guardRequest(notes({ method: "POST", headers: { ...mp, "content-length": "5000000" }, body: "x" }), opts)).toBeNull();
    expect(guardRequest(notes({ method: "POST", headers: { ...mp, "content-length": "90000000" }, body: "x" }), opts)?.status).toBe(413);
    expect(guardRequest(notes({ method: "POST", headers: mp, body: "x" }), opts)?.status).toBe(411); // an upload must declare its size
  });
  it("keeps every other route closed to uploads", () => {
    const withLen = { ...mp, "content-length": "1000" };
    expect(guardRequest(notes({ method: "PUT", headers: withLen, body: "x" }), opts)?.code).toBe("uploads_not_supported");
    expect(guardRequest(notes({ url: "http://localhost:3000/api/notes/abc", method: "POST", headers: withLen, body: "x" }), opts)?.code).toBe("uploads_not_supported");
    expect(guardRequest(notes({ url: "http://localhost:3000/api/contributions", method: "POST", headers: withLen, body: "x" }), opts)?.code).toBe("uploads_not_supported");
    expect(guardRequest(notes({ url: "http://localhost:3000/api/reports", method: "POST", headers: withLen, body: "x" }), opts)?.code).toBe("uploads_not_supported");
  });
  it("accepts only multipart/form-data on the upload route, still rejects cross-origin, and keeps the small JSON cap", () => {
    expect(guardRequest(notes({ method: "POST", headers: { "content-type": "application/pdf", "content-length": "1000" }, body: "x" }), opts)?.status).toBe(415);
    expect(guardRequest(notes({ method: "POST", headers: { "content-type": "application/octet-stream", "content-length": "1000" }, body: "x" }), opts)?.status).toBe(415);
    expect(guardRequest(notes({ method: "POST", headers: { ...mp, "content-length": "1000", origin: "https://evil.example" }, body: "x" }), opts)?.code).toBe("bad_origin");
    expect(guardRequest(notes({ method: "POST", headers: { "content-type": "application/json", "content-length": "999999" }, body: "{}" }), opts)?.status).toBe(413);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit within the window", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1000);
    expect(() => rateLimit("k", 3, 1000)).toThrow(/Too many/);
    rateLimit("other", 3, 1000);
  });
});
