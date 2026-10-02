import Link from "next/link";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/session";
import { isMaintainer } from "@/lib/types";
import { getAdminCourse } from "@/lib/services/catalog-admin";
import { ServiceError } from "@/lib/errors";
import { CourseDetailsForm, CourseStatusActions, OutlineImport, StructureEditor } from "@/components/CourseAdmin";

export const metadata = { title: "Manage course" };

export default async function ManageCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to continue.</div>;
  if (!isMaintainer(actor)) return <div className="notice bad" role="alert"><b>Permission denied.</b> Only maintainers can manage courses.</div>;
  let course;
  try {
    course = getAdminCourse(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const topicCount = course.units.reduce((n, u) => n + u.topics.length, 0);
  return (
    <>
      <p className="small"><Link href="/moderation?tab=courses">← Courses</Link></p>
      <h1>
        {course.code} · {course.title}{" "}
        {course.status === "archived" && <span className="badge demo">Archived</span>}
        {course.isDemo && <span className="badge demo">Demo course</span>}
      </h1>
      <p className="muted small">
        {course.universityName} · {course.units.length} unit{course.units.length === 1 ? "" : "s"}, {topicCount} topic{topicCount === 1 ? "" : "s"} ·{" "}
        {course.publishedCount} published question{course.publishedCount === 1 ? "" : "s"}
        {course.status === "active" && <> · <Link href={`/courses/${course.slug}`}>View public page</Link></>}
      </p>

      <h2>Details</h2>
      <CourseDetailsForm course={course} />

      <h2>Units and topics</h2>
      <p className="muted small">
        Learners pick topics from this list when they practise or contribute. Topics that questions use can be renamed but not deleted. Changes are logged in the audit log.
      </p>
      <StructureEditor course={course} />

      <h2>Add from an outline</h2>
      <OutlineImport courseId={course.id} />

      <h2>Status</h2>
      <CourseStatusActions course={course} />
    </>
  );
}
