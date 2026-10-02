import { describe, expect, it } from "vitest";
import { now, uid } from "@/lib/db";
import { getUniversity, listCourses, listUniversities } from "@/lib/services/catalog";
import { createCourseRequest } from "@/lib/services/reports";
import { freshDb, seeded } from "./helpers";

describe("university directory", () => {
  it("lists Western and U of T and keeps courses under their university", () => {
    const db = freshDb();
    seeded(db);
    expect(listUniversities()).toEqual([
      { slug: "western", name: "Western University", courseCount: 3 },
      { slug: "uoft", name: "University of Toronto", courseCount: 0 },
    ]);
    expect(getUniversity("uoft").name).toBe("University of Toronto");
    expect(listCourses("", "western")).toHaveLength(3);
    expect(listCourses("", "uoft")).toHaveLength(0);

    const uoft = db.prepare("SELECT id FROM university WHERE slug = 'uoft'").get() as { id: string };
    db.prepare("INSERT INTO course (id, university_id, slug, code, title, subject, status, created_at) VALUES (?,?,?,?,?,?,'active',?)")
      .run(uid(), uoft.id, "toronto-test", "TST100", "Test Course", "Testing", now());
    expect(listCourses("", "uoft").map((c) => c.slug)).toEqual(["toronto-test"]);
    expect(listCourses("TST100", "western")).toHaveLength(0);
    expect(listUniversities()[1].courseCount).toBe(1);
  });

  it("records the university on a course request", () => {
    const db = freshDb();
    createCourseRequest(null, { universitySlug: "uoft", code: "TST100", title: "Test Course", note: "" });
    const request = db.prepare("SELECT university_slug AS universitySlug FROM course_request").get() as { universitySlug: string };
    expect(request.universitySlug).toBe("uoft");
    expect(() => createCourseRequest(null, { universitySlug: "missing", code: "TST100", title: "", note: "" })).toThrow("Unknown university");
  });
});
