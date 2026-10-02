import { reviewerRoute } from "@/lib/http";
import { readNoteFile } from "@/lib/services/notes";

/**
 * Maintainers only (enforced in the service). Files are always served as a download of opaque bytes: never inline, never sniffed, and
 * sandboxed, so nothing a student uploads can run in the OpenFrame origin. Each download is written to the audit log.
 */
export const GET = reviewerRoute<{ id: string; fileId: string }>({}, ({ actor, params }) => {
  const f = readNoteFile(actor, params.id, params.fileId);
  const ascii = f.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Content-Length": String(f.bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "no-store",
    },
  });
});
