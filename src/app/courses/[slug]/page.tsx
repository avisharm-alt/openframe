import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/services/catalog";
import { ServiceError } from "@/lib/errors";
import { COURSE_NOTICE, STUDENT_REVIEWED_EXPLAINER } from "@/lib/copy";

export default async function CoursePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ review?: string }> }) {
  const { slug } = await params;
  const review = (await searchParams).review === "all" ? "all" : "reviewed";
  let course;
  try {
    course = getCourse(slug);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const count = (r: number, u: number) => (review === "all" ? r + u : r);
  const total = count(course.reviewedCount, course.unreviewedCount);
  return (
    <>
      <p className="small"><Link href="/">← All courses</Link></p>
      <h1>{course.code} · {course.title} {course.isDemo && <span className="badge demo">Demo course</span>}</h1>
      <p className="muted">{course.universityName} · {course.subject}</p>
      {course.description && <p>{course.description}</p>}
      {course.contexts.length > 0 && <p className="small muted">Offerings: {course.contexts.map((c) => `${c.label}${c.academicYear ? ` (${c.academicYear})` : ""}`).join(", ")}</p>}
      <div className="notice" role="note">{COURSE_NOTICE}</div>

      <nav className="tabs" aria-label="Review status filter">
        <Link href={`/courses/${slug}`} aria-current={review === "reviewed" ? "page" : undefined}>Student-reviewed ({course.reviewedCount})</Link>
        <Link href={`/courses/${slug}?review=all`} aria-current={review === "all" ? "page" : undefined}>Include unreviewed ({course.reviewedCount + course.unreviewedCount})</Link>
      </nav>
      <p className="small muted">{STUDENT_REVIEWED_EXPLAINER}</p>

      {total === 0 ? (
        <div className="notice warn" role="status">
          {course.reviewedCount + course.unreviewedCount === 0
            ? "This course has no published questions yet."
            : "This course has no student-reviewed questions yet. Switch to “Include unreviewed” to practise with unreviewed questions."}{" "}
          You can <Link href="/contribute">contribute a question</Link>.
        </div>
      ) : (
        <p><Link className="btn" href={`/practice/setup?course=${slug}${review === "all" ? "&unreviewed=1" : ""}`}>Start practice ({total} question{total === 1 ? "" : "s"})</Link></p>
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
