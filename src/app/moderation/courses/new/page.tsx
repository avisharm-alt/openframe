import Link from "next/link";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/session";
import { isMaintainer } from "@/lib/types";
import { adminUniversities, getCourseRequest } from "@/lib/services/catalog-admin";
import { ServiceError } from "@/lib/errors";
import { CreateCourseForm } from "@/components/CourseAdmin";

export const metadata = { title: "New course" };

export default async function NewCourse({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to continue.</div>;
  if (!isMaintainer(actor)) return <div className="notice bad" role="alert"><b>Permission denied.</b> Only maintainers can add courses.</div>;

  const requestId = (await searchParams).request;
  let request;
  if (requestId) {
    try {
      request = getCourseRequest(actor, requestId);
    } catch (e) {
      if (e instanceof ServiceError && e.status === 404) notFound();
      throw e;
    }
  }
  const open = request?.status === "open";
  return (
    <>
      <p className="small"><Link href="/moderation?tab=courses">← Courses</Link></p>
      <h1>New course</h1>
      <p className="muted small">
        Enter the course exactly as the university lists it. Verify the code, title and any units or topics against an official source; do not invent them.
        The course goes live as soon as you create it, with no questions yet.
      </p>
      {request && (
        <div className={open ? "notice" : "notice warn"} role="note">
          {open ? <><b>From a course request.</b> It is marked as added when you create this course.</> : <><b>This request was already handled</b> ({request.status}). The form below creates an ordinary course.</>}
          {request.note && <> Request note: “{request.note}”</>}
        </div>
      )}
      <CreateCourseForm
        universities={adminUniversities(actor)}
        initial={request ? { universitySlug: request.universitySlug, code: request.code, title: request.title } : undefined}
        requestId={open ? request!.id : undefined}
      />
    </>
  );
}
