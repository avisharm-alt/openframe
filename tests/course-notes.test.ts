import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, makeUser, seeded } from "./helpers";
import { saveCourseNote, readCourseNote, listCourseNotes, deleteCourseNote, MAX_NOTE_BYTES } from "@/lib/services/course-notes";
import { deleteAccount } from "@/lib/services/account";
import { guardRequest } from "@/lib/guard";
import { resetRateLimits } from "@/lib/ratelimit";
import type { DB } from "@/lib/db";

const auth = vi.hoisted(() => ({ actor: null as { id: string; role: "student" } | null }));
vi.mock("@/lib/http", async (original) => ({
  ...await original<typeof import("@/lib/http")>(),
  getActor: vi.fn(async () => auth.actor),
}));
import { POST } from "@/app/api/course-notes/route";
import { GET } from "@/app/api/course-notes/[id]/route";

let db: DB;
beforeEach(() => { vi.stubEnv("BASE_URL", "http://localhost:3000"); });
afterEach(() => { db?.close(); auth.actor = null; resetRateLimits(); vi.unstubAllEnvs(); });

describe("private course notes", () => {
  it("stores notes privately, restricts access, and deletes uploads with an account", () => {
    db = freshDb();
    const course = seeded(db).demo101;
    const owner = makeUser(db, "owner");
    const other = makeUser(db, "other");
    const reviewer = makeUser(db, "reviewer", "reviewer");
    const note = saveCourseNote(owner, course.courseId, "../notes.txt", Buffer.from("Lecture notes"), true);
    expect(note.filename).toBe("notes.txt");
    expect(readCourseNote(owner, note.id).content.toString()).toBe("Lecture notes");
    expect(readCourseNote(reviewer, note.id).filename).toBe("notes.txt");
    expect(() => readCourseNote(other, note.id)).toThrow("permission");
    expect(() => deleteCourseNote(other, note.id)).toThrow("permission");
    expect(listCourseNotes(other)).toEqual([]);
    expect(() => listCourseNotes(other, true)).toThrow("permission");
    expect(listCourseNotes(reviewer, true)).toHaveLength(1);
    deleteAccount(owner.id);
    expect(() => readCourseNote(reviewer, note.id)).toThrow("not found");
  });

  it("rejects unsupported files, invalid courses, missing permission and large uploads", () => {
    db = freshDb();
    const course = seeded(db).demo101;
    const owner = makeUser(db, "owner");
    for (const [filename, content] of [["notes.pdf", Buffer.from("not a pdf")], ["notes.html", Buffer.from("<script>")], ["notes.txt", Buffer.from([0xff])], ["notes.txt", Buffer.from([0])], ["notes.txt", Buffer.alloc(0)], ["notes.txt", Buffer.alloc(MAX_NOTE_BYTES + 1)]] as const) {
      expect(() => saveCourseNote(owner, course.courseId, filename, content, true)).toThrow();
    }
    expect(() => saveCourseNote(owner, course.courseId, "notes.txt", Buffer.from("notes"), false)).toThrow("Confirm");
    expect(() => saveCourseNote(owner, "missing", "notes.txt", Buffer.from("notes"), true)).toThrow("available course");
    expect(listCourseNotes(owner)).toHaveLength(0);
    const note = saveCourseNote(owner, course.courseId, "notes.pdf", Buffer.from("%PDF-1.4\nnotes"), true);
    deleteCourseNote(owner, note.id);
    expect(listCourseNotes(owner)).toHaveLength(0);
  });

  it("accepts authenticated multipart, returns private attachments and rejects guest access", async () => {
    db = freshDb();
    const course = seeded(db).demo101;
    const owner = makeUser(db, "owner");
    const upload = () => {
      const form = new FormData();
      form.set("courseId", course.courseId); form.set("permission", "true");
      form.set("file", new Blob(["Original course notes"], { type: "text/plain" }), "notes.txt");
      return new Request("http://localhost:3000/api/course-notes", { method: "POST", body: form, headers: { origin: "http://localhost:3000", host: "localhost:3000" } });
    };
    const guest = await POST(upload());
    expect(await guest.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in to upload course notes." } });
    expect(guest.status).toBe(401);
    auth.actor = { id: owner.id, role: "student" };
    const res = await POST(upload());
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const get = await GET(new Request("http://localhost:3000/api/course-notes/" + id), { params: Promise.resolve({ id }) });
    expect(get.headers.get("content-disposition")).toContain("attachment");
    expect(get.headers.get("cache-control")).toBe("private, no-store");
    expect(await get.text()).toBe("Original course notes");
    auth.actor = null;
    expect((await GET(new Request("http://localhost:3000/api/course-notes/" + id), { params: Promise.resolve({ id }) })).status).toBe(401);
    auth.actor = { id: owner.id, role: "student" };
    const oversized = new Request("http://localhost:3000/api/course-notes", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body: new Uint8Array(MAX_NOTE_BYTES + 100_000) });
    expect((await POST(oversized)).status).toBe(413);
    const crossOrigin = upload();
    crossOrigin.headers.set("origin", "https://other.example");
    expect((await POST(crossOrigin)).status).toBe(403);
  });

  it("allows multipart only at the notes endpoint with size and origin checks", () => {
    const opts = { baseUrl: "http://localhost:3000", trustProxy: false };
    const form = new FormData(); form.set("file", new Blob(["notes"]), "notes.txt");
    const req = new Request("http://localhost:3000/api/course-notes", { method: "POST", body: form });
    expect(guardRequest(req, opts)).toBeNull();
    req.headers.set("content-length", String(MAX_NOTE_BYTES + 100_000));
    expect(guardRequest(req, opts)?.status).toBe(413);
    req.headers.delete("content-length"); req.headers.set("origin", "https://other.example");
    expect(guardRequest(req, opts)?.status).toBe(403);
    expect(guardRequest(new Request("http://localhost:3000/api/contributions", { method: "POST", body: form }), opts)?.status).toBe(415);
  });
});
