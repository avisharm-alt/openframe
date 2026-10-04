import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/services/catalog";
import { ServiceError } from "@/lib/errors";
import { COURSE_NOTICE } from "@/lib/copy";

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let course;
  try {
    course = getCourse(slug);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const count = (r: number, u: number) => r + u;
  const total = count(course.reviewedCount, course.unreviewedCount);
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
          This course has no published questions yet.{" "}
          You can <Link href="/course-notes">upload course notes</Link>.
        </div>
      ) : (
        <p><Link className="btn" href={`/practice/setup?course=${slug}`}>Start practice ({total} question{total === 1 ? "" : "s"})</Link></p>
      )}

      {course.units.map((u) => (
        <section key={u.id} aria-labelledby={`u-${u.id}`}>
          <h2 id={`u-${u.id}`}>{u.title}</h2>
          <ul>
            {u.topics.map((t) => (
              <li key={t.id}>
                {t.title} — <span className="muted">{count(t.reviewedCount, t.unreviewedCount)} question{count(t.reviewedCount, t.unreviewedCount) === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
