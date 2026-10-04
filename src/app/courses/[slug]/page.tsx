import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/services/catalog";
import { ServiceError } from "@/lib/errors";
import { COURSE_NOTICE, VERIFIED_EXPLAINER } from "@/lib/copy";
import { config } from "@/lib/config";

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let course;
  try {
    course = getCourse(slug);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const total = course.totalCount;
  return (
    <>
      <p className="small"><Link href={`/universities/${course.universitySlug}`}>← {course.universityName} courses</Link></p>
      <h1>{course.code} · {course.title} {course.isDemo && <span className="badge demo">Demo course</span>}</h1>
      <p className="muted">{course.universityName} · {course.subject}</p>
      {course.description && <p>{course.description}</p>}
      {course.contexts.length > 0 && <p className="small muted">Offerings: {course.contexts.map((c) => `${c.label}${c.academicYear ? ` (${c.academicYear})` : ""}`).join(", ")}</p>}
      <div className="notice" role="note">{COURSE_NOTICE}</div>

      {total === 0 ? (
        <div className="notice warn" role="status">
          This course has no published questions yet.{config.notesUploadsEnabled && <> You can <Link href="/course-notes">upload your own course notes</Link>.</>}
        </div>
      ) : (
        <>
          <p role="status" style={{ fontSize: "1.05rem" }}>
            <b>{course.verifiedCount}</b> of <b>{total}</b> question{total === 1 ? "" : "s"} verified
            {course.unverifiedCount > 0 && <span className="muted"> · {course.unverifiedCount} unverified</span>}
          </p>
          <p className="small muted">{VERIFIED_EXPLAINER}</p>
          {course.verifiedCount > 0 ? (
            <p className="row">
              <Link className="btn" href={`/practice/setup?course=${slug}`}>Practice verified questions ({course.verifiedCount})</Link>
              {course.unverifiedCount > 0 && <Link className="btn secondary" href={`/practice/setup?course=${slug}&unverified=1`}>Include unverified ({total} in all)</Link>}
            </p>
          ) : (
            <div className="notice warn" role="note">
              <p>No question in this course has been verified yet. Verification needs two independent student reviewers per question.</p>
              <p><Link className="btn secondary" href={`/practice/setup?course=${slug}&unverified=1`}>Practise unverified questions ({total})</Link></p>
            </div>
          )}
        </>
      )}

      {course.units.map((u) => (
        <section key={u.id} aria-labelledby={`u-${u.id}`}>
          <h2 id={`u-${u.id}`}>{u.title}</h2>
          <ul>
            {u.topics.map((t) => (
              <li key={t.id}>
                {t.title} — <span className="muted">{t.verifiedCount} of {t.totalCount} verified</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
