import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { DB } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { contributionTargets, getCourse, getPublicQuestion, listCourses } from "@/lib/services/catalog";
import {
  addOutline,
  createCourse,
  createTopic,
  createUnit,
  deleteCourse,
  deleteTopic,
  deleteUnit,
  getAdminCourse,
  listAdminCourses,
  parseOutline,
  setCourseRequestStatus,
  slugify,
  updateCourse,
  updateTopic,
  updateUnit,
} from "@/lib/services/catalog-admin";
import { createDraft, updateDraft } from "@/lib/services/contributions";
import { listCourseRequests, listEvents } from "@/lib/services/moderation";
import { createSession, getSessionState } from "@/lib/services/practice";
import { createCourseRequest } from "@/lib/services/reports";
import type { Actor } from "@/lib/types";
import { freshDb, makeUser, publishNew, seeded, validDraft } from "./helpers";

let db: DB;
let maintainer: Actor;
beforeEach(() => {
  db = freshDb();
  maintainer = makeUser(db, "Maria Maintainer", "maintainer");
});

const NEW = { universitySlug: "uoft", code: "CSC 108", title: "Introduction to Computer Programming", subject: "Computer Science" };
const OUTLINE = "Foundations\n- Variables\n- Types\n\nControl flow\n- Loops\n- Conditionals\n";

/** Audit actions logged so far. Events written in the same millisecond have no defined order, so never assert on order. */
const actions = () => (listEvents(maintainer) as { action: string }[]).map((e) => e.action);

/** Rejects with a ServiceError of the given status/code (or a ZodError for 422 schema failures). */
const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw");
};

describe("access control", () => {
  it("is maintainer-only for every operation", () => {
    const course = createCourse(maintainer, NEW);
    const unit = createUnit(maintainer, course.id, { title: "U" });
    const topic = createTopic(maintainer, unit.id, { title: "T" });
    const request = createCourseRequest(null, { universitySlug: "uoft", code: "X1", title: "", note: "" });
    for (const role of ["student", "reviewer"] as const) {
      const a = makeUser(db, `${role} person`, role);
      const calls: (() => unknown)[] = [
        () => listAdminCourses(a),
        () => getAdminCourse(a, course.id),
        () => createCourse(a, { ...NEW, code: "ZZZ 999" }),
        () => updateCourse(a, course.id, { title: "Hacked" }),
        () => deleteCourse(a, course.id),
        () => addOutline(a, course.id, { text: OUTLINE }),
        () => createUnit(a, course.id, { title: "X" }),
        () => updateUnit(a, unit.id, { title: "X" }),
        () => deleteUnit(a, unit.id),
        () => createTopic(a, unit.id, { title: "X" }),
        () => updateTopic(a, topic.id, { title: "X" }),
        () => deleteTopic(a, topic.id),
        () => setCourseRequestStatus(a, request.id, { status: "dismissed" }),
      ];
      for (const call of calls) expect(failure(call)).toMatchObject({ status: 403 });
    }
    expect(getCourse(course.slug).title).toBe(NEW.title); // nothing changed
  });
});

describe("parseOutline", () => {
  it("reads units and topics, ignoring blank lines, headings marks and indentation", () => {
    expect(parseOutline("# Unit A\r\n  - One\r\n  * Two\r\n\r\nUnit B\r\n• Three\r\n-Four")).toEqual([
      { title: "Unit A", topics: ["One", "Two"] },
      { title: "Unit B", topics: ["Three", "Four"] },
    ]);
    expect(parseOutline("Only a unit")).toEqual([{ title: "Only a unit", topics: [] }]);
    expect(parseOutline("U\n-   Spaced   out   title  ")[0].topics).toEqual(["Spaced out title"]);
  });

  it("names the line of each problem", () => {
    expect(failure(() => parseOutline("- orphan topic"))).toMatchObject({ status: 422, message: expect.stringContaining("Line 1") });
    expect(failure(() => parseOutline("U\n-\n"))).toMatchObject({ message: expect.stringContaining("Line 2") });
    expect(failure(() => parseOutline("U\n- A\n- a"))).toMatchObject({ message: expect.stringContaining("Line 3") });
    expect(failure(() => parseOutline("U\n- A\nu"))).toMatchObject({ message: expect.stringContaining("Line 3") });
    expect(failure(() => parseOutline("U\n- " + "x".repeat(161)))).toMatchObject({ message: expect.stringContaining("Line 2") });
    expect(failure(() => parseOutline("  \n \n"))).toMatchObject({ status: 422 });
    expect(failure(() => parseOutline(Array.from({ length: 41 }, (_, i) => `Unit ${i}`).join("\n")))).toMatchObject({ message: expect.stringContaining("Line 41") });
  });
});

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("CS 1026A")).toBe("cs-1026a");
    expect(slugify("  MATH—1600/B ")).toBe("math-1600-b");
    expect(slugify("Écon 101")).toBe("econ-101");
  });
});

describe("creating courses", () => {
  it("creates a public course with units and topics, in outline order, and audits it", () => {
    const r = createCourse(maintainer, { ...NEW, description: "Intro course.", outline: OUTLINE });
    expect(r).toMatchObject({ slug: "csc-108", units: 2, topics: 4 });

    const admin = getAdminCourse(maintainer, r.id);
    expect(admin).toMatchObject({ code: "CSC 108", status: "active", isDemo: false, universitySlug: "uoft", description: "Intro course." });
    expect(admin.units.map((u) => [u.title, u.topics.map((t) => t.title)])).toEqual([
      ["Foundations", ["Variables", "Types"]],
      ["Control flow", ["Loops", "Conditionals"]],
    ]);

    // Visible in the public catalog under the right university, and open to contributions.
    expect(listCourses("", "uoft").map((c) => c.slug)).toEqual(["csc-108"]);
    expect(listCourses("", "western")).toHaveLength(0);
    expect(getCourse("csc-108").units.map((u) => u.title)).toEqual(["Foundations", "Control flow"]);
    expect(listCourses("loops")[0].topicMatches).toEqual(["Loops"]);
    expect(contributionTargets().find((c) => c.id === r.id)?.topics.map((t) => t.title)).toEqual(["Variables", "Types", "Loops", "Conditionals"]);

    const events = listEvents(maintainer) as { action: string; detail: string; actorName: string }[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "course_created", actorName: "Maria Maintainer" });
    expect(JSON.parse(events[0].detail)).toMatchObject({ code: "CSC 108", university: "uoft", units: 2, topics: 4 });
  });

  it("normalises whitespace and rejects invalid input", () => {
    const r = createCourse(maintainer, { ...NEW, code: "  CSC   108 ", title: "  Spaced\n title ", outline: "" });
    expect(getAdminCourse(maintainer, r.id)).toMatchObject({ code: "CSC 108", title: "Spaced title" });
    expect(failure(() => createCourse(maintainer, { ...NEW, code: "ZZ 9", title: "" }))).toBeInstanceOf(ZodError);
    expect(failure(() => createCourse(maintainer, { ...NEW, code: "!" }))).toBeInstanceOf(ZodError);
    expect(failure(() => createCourse(maintainer, { ...NEW, code: "ZZ 9", isDemo: true }))).toBeInstanceOf(ZodError); // strict
    expect(failure(() => createCourse(maintainer, { ...NEW, code: "ZZ 9", universitySlug: "nowhere" }))).toMatchObject({ status: 422 });
  });

  it("refuses a duplicate code at the same university (any case, even archived) but allows it elsewhere", () => {
    const a = createCourse(maintainer, NEW);
    expect(failure(() => createCourse(maintainer, { ...NEW, code: "csc 108" }))).toMatchObject({ status: 409, code: "duplicate_course" });
    updateCourse(maintainer, a.id, { status: "archived" });
    expect(failure(() => createCourse(maintainer, NEW))).toMatchObject({ status: 409, message: expect.stringContaining("archived") });
    const other = createCourse(maintainer, { ...NEW, universitySlug: "western" });
    expect(other.slug).toBe("western-csc-108"); // base slug is taken by the U of T course
    expect(createCourse(maintainer, { ...NEW, universitySlug: "western", code: "CSC-108" }).slug).toBe("western-csc-108-2");
  });

  it("is atomic: a bad outline or a handled request creates nothing", () => {
    const before = listAdminCourses(maintainer).length;
    expect(failure(() => createCourse(maintainer, { ...NEW, outline: "- no unit" }))).toMatchObject({ status: 422 });
    expect(listAdminCourses(maintainer)).toHaveLength(before);
    const bogus = crypto.randomUUID();
    expect(failure(() => createCourse(maintainer, { ...NEW, requestId: bogus }))).toMatchObject({ status: 404 });
    expect(listAdminCourses(maintainer)).toHaveLength(before);
  });
});

describe("editing, archiving and deleting courses", () => {
  it("edits details but keeps the public URL stable", () => {
    const { id, slug } = createCourse(maintainer, NEW);
    expect(updateCourse(maintainer, id, { code: "CSC 108H1", title: "Intro Programming" }).changed).toEqual(["code", "title"]);
    expect(getAdminCourse(maintainer, id)).toMatchObject({ slug, code: "CSC 108H1", title: "Intro Programming" });
    expect(getCourse(slug).code).toBe("CSC 108H1");
    expect(updateCourse(maintainer, id, { title: "Intro Programming" }).changed).toEqual([]); // no-op, no audit entry
    expect(actions().filter((a) => a === "course_updated")).toHaveLength(1);
    expect(failure(() => updateCourse(maintainer, id, {}))).toBeInstanceOf(ZodError);
    expect(failure(() => updateCourse(maintainer, crypto.randomUUID(), { title: "x" }))).toMatchObject({ status: 404 });
    createCourse(maintainer, { ...NEW, code: "CSC 111" });
    expect(failure(() => updateCourse(maintainer, id, { code: "csc 111" }))).toMatchObject({ status: 409 });
  });

  it("archiving hides the course everywhere learners look; restoring brings it back", () => {
    const db2 = db;
    const { id, slug } = createCourse(maintainer, { ...NEW, outline: OUTLINE });
    const author = makeUser(db2, "Author");
    const topicId = getAdminCourse(maintainer, id).units[0].topics[0].id;
    const reviewer = makeUser(db2, "Reviewer", "reviewer");
    const { questionId } = publishNew(db2, author, reviewer, id, topicId);
    const running = createSession(null, { courseId: id, count: 5, mode: "practice", includeUnreviewed: false });
    expect(running.total).toBe(1);

    updateCourse(maintainer, id, { status: "archived" });
    // Documented behaviour (docs/MAINTAINERS.md): archiving does not cut off sessions in progress or direct links to a
    // question; taking a question down is what "withdraw" is for.
    expect(getSessionState(running.id, null).items[0].status).toBe("available");
    expect(getPublicQuestion(questionId).id).toBe(questionId);
    expect(listCourses("", "uoft")).toHaveLength(0);
    expect(contributionTargets().some((c) => c.id === id)).toBe(false);
    expect(failure(() => getCourse(slug))).toMatchObject({ status: 404 });
    expect(failure(() => createSession(null, { courseId: id, count: 5, mode: "practice", includeUnreviewed: false }))).toMatchObject({ status: 422 });
    expect(failure(() => createDraft(author, validDraft(id, topicId)))).toMatchObject({ status: 422 });
    expect(listAdminCourses(maintainer).find((c) => c.id === id)).toMatchObject({ status: "archived", publishedCount: 1 }); // still manageable

    updateCourse(maintainer, id, { status: "active" });
    expect(getCourse(slug).code).toBe("CSC 108");
    expect(createSession(null, { courseId: id, count: 5, mode: "practice", includeUnreviewed: false }).total).toBe(1);
    expect(actions()).toEqual(expect.arrayContaining(["course_archived", "course_restored"]));
  });

  it("deletes only courses that never had a question", () => {
    seeded(db);
    const demo = listAdminCourses(maintainer).find((c) => c.slug === "demo-101")!;
    expect(failure(() => deleteCourse(maintainer, demo.id))).toMatchObject({ status: 409, code: "course_in_use" });

    const { id } = createCourse(maintainer, { ...NEW, outline: OUTLINE });
    expect(deleteCourse(maintainer, id)).toEqual({ deleted: true });
    expect(listAdminCourses(maintainer).some((c) => c.id === id)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM unit WHERE course_id = ?").get(id)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM topic WHERE course_id = ?").get(id)).toEqual({ n: 0 });
    expect(failure(() => deleteCourse(maintainer, id))).toMatchObject({ status: 404 });
    expect(actions()).toContain("course_deleted");
  });

  it("lists every course with counts for the maintainer", () => {
    seeded(db);
    createCourse(maintainer, { ...NEW, outline: OUTLINE });
    const rows = listAdminCourses(maintainer);
    expect(rows.find((c) => c.slug === "demo-101")).toMatchObject({ isDemo: true, status: "active", universitySlug: "western" });
    expect(rows.find((c) => c.slug === "demo-101")!.publishedCount).toBeGreaterThan(0);
    expect(rows.find((c) => c.slug === "csc-108")).toMatchObject({ unitCount: 2, topicCount: 4, questionCount: 0, universityName: "University of Toronto" });
    expect(rows.findIndex((c) => c.universitySlug === "western")).toBeLessThan(rows.findIndex((c) => c.universitySlug === "uoft"));
  });
});

describe("units and topics", () => {
  let courseId: string;
  beforeEach(() => {
    courseId = createCourse(maintainer, { ...NEW, outline: OUTLINE }).id;
  });
  const shape = () => getAdminCourse(maintainer, courseId).units.map((u) => [u.title, u.topics.map((t) => t.title)]);

  it("adds, renames and rejects duplicates (case-insensitive)", () => {
    const u = createUnit(maintainer, courseId, { title: "  Data   structures " });
    const t = createTopic(maintainer, u.id, { title: "Lists" });
    expect(shape()[2]).toEqual(["Data structures", ["Lists"]]);
    expect(failure(() => createUnit(maintainer, courseId, { title: "data structures" }))).toMatchObject({ status: 409, code: "duplicate_unit" });
    expect(failure(() => createTopic(maintainer, u.id, { title: "LISTS" }))).toMatchObject({ status: 409, code: "duplicate_topic" });
    createTopic(maintainer, getAdminCourse(maintainer, courseId).units[0].id, { title: "Lists" }); // same title, different unit is fine
    updateUnit(maintainer, u.id, { title: "Collections" });
    updateTopic(maintainer, t.id, { title: "Arrays" });
    expect(shape()[2]).toEqual(["Collections", ["Arrays"]]);
    expect(failure(() => updateUnit(maintainer, u.id, { title: "Foundations" }))).toMatchObject({ status: 409 });
    expect(failure(() => updateUnit(maintainer, u.id, { title: "x", move: "up" }))).toBeInstanceOf(ZodError);
    expect(failure(() => updateUnit(maintainer, u.id, {}))).toBeInstanceOf(ZodError);
    expect(failure(() => createTopic(maintainer, crypto.randomUUID(), { title: "x" }))).toMatchObject({ status: 404 });
    expect(failure(() => createUnit(maintainer, crypto.randomUUID(), { title: "x" }))).toMatchObject({ status: 404 });
  });

  it("reorders within the parent and ignores moves past the ends", () => {
    const [foundations, control] = getAdminCourse(maintainer, courseId).units;
    expect(updateUnit(maintainer, control.id, { move: "up" })).toMatchObject({ moved: true });
    expect(shape().map((s) => s[0])).toEqual(["Control flow", "Foundations"]);
    expect(updateUnit(maintainer, control.id, { move: "up" })).toMatchObject({ moved: false });
    expect(updateUnit(maintainer, foundations.id, { move: "down" })).toMatchObject({ moved: false });

    const types = foundations.topics[1];
    expect(updateTopic(maintainer, types.id, { move: "up" })).toMatchObject({ moved: true });
    expect(shape()[1]).toEqual(["Foundations", ["Types", "Variables"]]);
    // Topics never cross units.
    expect(updateTopic(maintainer, types.id, { move: "up" })).toMatchObject({ moved: false });
  });

  it("repairs tied positions when reordering", () => {
    db.prepare("UPDATE topic SET position = 0 WHERE unit_id = (SELECT id FROM unit WHERE title = 'Foundations')").run();
    const [a, b] = getAdminCourse(maintainer, courseId).units[0].topics;
    updateTopic(maintainer, b.id, { move: "up" });
    expect(shape()[0][1]).toEqual([b.title, a.title]);
    const positions = db.prepare("SELECT position FROM topic WHERE unit_id = (SELECT id FROM unit WHERE title = 'Foundations') ORDER BY position").all();
    expect(positions).toEqual([{ position: 0 }, { position: 1 }]);
  });

  it("deletes empty topics and units, and renumbers what is left", () => {
    const [foundations, control] = getAdminCourse(maintainer, courseId).units;
    deleteTopic(maintainer, foundations.topics[0].id);
    expect(shape()[0]).toEqual(["Foundations", ["Types"]]);
    const afterDelete = db.prepare("SELECT position FROM topic WHERE unit_id = ?").all(foundations.id);
    expect(afterDelete).toEqual([{ position: 0 }]);
    deleteUnit(maintainer, foundations.id);
    expect(shape()).toEqual([["Control flow", ["Loops", "Conditionals"]]]);
    expect(db.prepare("SELECT position FROM unit WHERE id = ?").get(control.id)).toEqual({ position: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM topic WHERE unit_id = ?").get(foundations.id)).toEqual({ n: 0 }); // cascaded
    expect(actions()).toEqual(expect.arrayContaining(["unit_deleted", "topic_deleted"]));
  });

  it("never deletes a topic or unit that questions use, but still allows renaming", () => {
    const author = makeUser(db, "Author");
    const reviewer = makeUser(db, "Reviewer", "reviewer");
    const [foundations, control] = getAdminCourse(maintainer, courseId).units;
    const [variables, types] = foundations.topics;
    const published = publishNew(db, author, reviewer, courseId, variables.id);

    expect(failure(() => deleteTopic(maintainer, variables.id))).toMatchObject({ status: 409, code: "topic_in_use" });
    expect(failure(() => deleteUnit(maintainer, foundations.id))).toMatchObject({ status: 409, code: "unit_in_use" });
    expect(getAdminCourse(maintainer, courseId).units[0].topics[0].questionCount).toBe(1);
    updateTopic(maintainer, variables.id, { title: "Variables and names" });
    expect(getCourse("csc-108").units[0].topics[0]).toMatchObject({ title: "Variables and names", reviewedCount: 1 });

    // A topic that only a draft revision points at (a pending topic change) is in use too.
    const { id: draftQ } = createDraft(author, validDraft(courseId, types.id));
    updateDraft(author, draftQ, validDraft(courseId, control.topics[0].id));
    expect(failure(() => deleteTopic(maintainer, control.topics[0].id))).toMatchObject({ status: 409 });
    expect(published.questionId).toBeTruthy();
  });
});

describe("adding an outline to an existing course", () => {
  it("appends units after the existing ones", () => {
    const { id } = createCourse(maintainer, { ...NEW, outline: OUTLINE });
    expect(addOutline(maintainer, id, { text: "Functions\n- Calls\n- Scope" })).toEqual({ units: 1, topics: 2 });
    expect(getAdminCourse(maintainer, id).units.map((u) => u.title)).toEqual(["Foundations", "Control flow", "Functions"]);
  });

  it("is all-or-nothing when a unit title already exists", () => {
    const { id } = createCourse(maintainer, { ...NEW, outline: OUTLINE });
    expect(failure(() => addOutline(maintainer, id, { text: "Functions\n- Calls\n\nfoundations\n- Oops" }))).toMatchObject({ status: 409, code: "duplicate_unit" });
    expect(getAdminCourse(maintainer, id).units.map((u) => u.title)).toEqual(["Foundations", "Control flow"]);
    expect(failure(() => addOutline(maintainer, id, { text: "- orphan" }))).toMatchObject({ status: 422 });
    expect(failure(() => addOutline(maintainer, crypto.randomUUID(), { text: "A" }))).toMatchObject({ status: 404 });
  });
});

describe("course requests", () => {
  const request = () => createCourseRequest(null, { universitySlug: "uoft", code: "CSC 108", title: "Intro", note: "please" }).id;

  it("are marked added when a course is created from them", () => {
    const id = request();
    const other = request();
    expect(listCourseRequests(maintainer).map((r) => r.id).sort()).toEqual([id, other].sort());
    const course = createCourse(maintainer, { ...NEW, requestId: id });
    expect(listCourseRequests(maintainer).map((r) => r.id)).toEqual([other]);
    expect(listCourseRequests(maintainer, "added")[0]).toMatchObject({ id, status: "added", courseId: course.id, courseSlug: "csc-108" });
    expect(listCourseRequests(maintainer, "all")).toHaveLength(2);
    // A handled request cannot be used again, and a failed attempt creates no course.
    expect(failure(() => createCourse(maintainer, { ...NEW, code: "CSC 999", requestId: id }))).toMatchObject({ status: 409, code: "request_handled" });
    expect(listAdminCourses(maintainer).some((c) => c.code === "CSC 999")).toBe(false);
    expect(failure(() => setCourseRequestStatus(maintainer, id, { status: "dismissed" }))).toMatchObject({ status: 409 });
  });

  it("can be dismissed and reopened", () => {
    const id = request();
    expect(setCourseRequestStatus(maintainer, id, { status: "dismissed" })).toEqual({ status: "dismissed" });
    expect(listCourseRequests(maintainer)).toHaveLength(0);
    expect(listCourseRequests(maintainer, "dismissed")[0]).toMatchObject({ id });
    expect(setCourseRequestStatus(maintainer, id, { status: "open" })).toEqual({ status: "open" });
    expect(listCourseRequests(maintainer)).toHaveLength(1);
    expect(failure(() => setCourseRequestStatus(maintainer, id, { status: "added" }))).toBeInstanceOf(ZodError);
    expect(failure(() => setCourseRequestStatus(maintainer, crypto.randomUUID(), { status: "dismissed" }))).toMatchObject({ status: 404 });
    expect(actions()).toEqual(expect.arrayContaining(["course_request_dismissed", "course_request_reopened"]));
  });

  it("only reviewers and above can list them", () => {
    expect(failure(() => listCourseRequests(makeUser(db, "Student")))).toMatchObject({ status: 403 });
    expect(() => listCourseRequests(makeUser(db, "Reviewer", "reviewer"))).not.toThrow();
  });
});

it("ServiceError is what the route wrapper maps to HTTP statuses", () => {
  expect(failure(() => createUnit(maintainer, crypto.randomUUID(), { title: "x" }))).toBeInstanceOf(ServiceError);
});
