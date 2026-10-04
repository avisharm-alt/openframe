import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, makeUser, seeded } from "./helpers";
import { saveCourseNote, readCourseNote, listCourseNotes, deleteCourseNote, MAX_NOTE_BYTES } from "@/lib/services/course-notes";
import { config } from "@/lib/config";
import { NOTES_ATTESTATION_TEXT } from "@/lib/attestation";
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
import { GET, DELETE } from "@/app/api/course-notes/[id]/route";

let db: DB;
beforeEach(() => { vi.stubEnv("BASE_URL", "http://localhost:3000"); vi.stubEnv("OPENFRAME_NOTES_UPLOADS", "1"); });
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
    expect(() => saveCourseNote(owner, course.courseId, "notes.txt", Buffer.from("notes"), false)).toThrow("your own notes");
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
      form.set("courseId", course.courseId); form.set("ownNotes", "true");
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
    const opts = { baseUrl: "http://localhost:3000", trustProxy: false, notesUploads: true };
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

describe("OPENFRAME_NOTES_UPLOADS feature flag", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const upload = (courseId: string) => {
    const form = new FormData();
    form.set("courseId", courseId); form.set("ownNotes", "true");
    form.set("file", new Blob(["My own notes"], { type: "text/plain" }), "notes.txt");
    return new Request("http://localhost:3000/api/course-notes", { method: "POST", body: form, headers: { origin: "http://localhost:3000", host: "localhost:3000" } });
  };

  it("is off unless explicitly enabled", () => {
    vi.unstubAllEnvs();
    expect(config.notesUploadsEnabled).toBe(false);
    for (const v of ["0", "", "false", "yes"]) { vi.stubEnv("OPENFRAME_NOTES_UPLOADS", v); expect(config.notesUploadsEnabled).toBe(false); }
    for (const v of ["1", "true"]) { vi.stubEnv("OPENFRAME_NOTES_UPLOADS", v); expect(config.notesUploadsEnabled).toBe(true); }
  });

  it("returns 404 from every notes endpoint while off, and leaves existing uploads untouched", async () => {
    db = freshDb();
    const course = seeded(db).demo101;
    const owner = makeUser(db, "owner");
    const reviewer = makeUser(db, "reviewer", "reviewer");
    const note = saveCourseNote(owner, course.courseId, "notes.txt", Buffer.from("Existing notes"), true);
    const snapshot = () => db.prepare("SELECT id, owner_id, filename, size_bytes, content, created_at, attestation_text FROM course_note").all();
    const before = snapshot();
    expect(before).toHaveLength(1);

    vi.stubEnv("OPENFRAME_NOTES_UPLOADS", "0");
    for (const actor of [null, { id: owner.id, role: "student" as const }]) {
      auth.actor = actor;
      expect((await POST(upload(course.courseId))).status).toBe(404);
      expect((await GET(new Request("http://localhost:3000/api/course-notes/" + note.id), ctx(note.id))).status).toBe(404);
      expect((await DELETE(new Request("http://localhost:3000/api/course-notes/" + note.id, { method: "DELETE", headers: { origin: "http://localhost:3000" } }), ctx(note.id))).status).toBe(404);
    }
    expect(() => saveCourseNote(owner, course.courseId, "more.txt", Buffer.from("x"), true)).toThrow("Not found");
    expect(() => readCourseNote(reviewer, note.id)).toThrow("Not found");
    expect(() => deleteCourseNote(owner, note.id)).toThrow("Not found");
    expect(() => listCourseNotes(owner)).toThrow("Not found");
    expect(snapshot()).toEqual(before);

    // The request guard answers 404 too, before it looks at the body.
    const opts = { baseUrl: "http://localhost:3000", trustProxy: false };
    expect(guardRequest(upload(course.courseId), opts)).toMatchObject({ status: 404 });
    expect(guardRequest(upload(course.courseId), { ...opts, notesUploads: false })).toMatchObject({ status: 404 });
    expect(guardRequest(new Request("http://localhost:3000/api/course-notes/x", { method: "DELETE" }), opts)).toMatchObject({ status: 404 });
    expect(guardRequest(new Request("http://localhost:3000/api/contributions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), opts)).toBeNull();

    // Switching it back on restores access to the same files.
    vi.stubEnv("OPENFRAME_NOTES_UPLOADS", "1");
    expect(readCourseNote(owner, note.id).content.toString()).toBe("Existing notes");
  });

  it("asks for confirmation that the file is the uploader's own notes and keeps what they confirmed", () => {
    db = freshDb();
    const course = seeded(db).demo101;
    const owner = makeUser(db, "owner");
    expect(NOTES_ATTESTATION_TEXT).toMatch(/my own notes/);
    expect(NOTES_ATTESTATION_TEXT).toMatch(/not instructor slides, handouts/);
    expect(NOTES_ATTESTATION_TEXT).toMatch(/past assessments/);
    expect(() => saveCourseNote(owner, course.courseId, "notes.txt", Buffer.from("n"), false)).toThrow(/your own notes, not instructor slides, handouts or past assessments/);
    const { id } = saveCourseNote(owner, course.courseId, "notes.txt", Buffer.from("n"), true);
    expect((db.prepare("SELECT attestation_text AS t FROM course_note WHERE id = ?").get(id) as { t: string }).t).toBe(NOTES_ATTESTATION_TEXT);
  });
});
