import Link from "next/link";
import { listCourses } from "@/lib/services/catalog";
import { CourseRequestForm } from "@/components/CourseRequestForm";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const courses = listCourses(q);
  const all = q ? listCourses() : courses;
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Find practice questions for your course</h1>
          <p className="lead">OpenFrame is a free, open-source, student-run question bank. Search by course code, title or topic. Every question has an explanation for each option, and you don’t need an account to practise.</p>
          <form role="search" className="search" action="/" method="get">
            <label htmlFor="q" className="sr-only">Search courses and topics</label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="e.g. DEMO-102, statistics, recursion" autoComplete="off" />
            <button className="btn">Search</button>
          </form>
        </div>
      </section>

      {courses.length > 0 ? (
        <section aria-labelledby="results-h">
          <h2 id="results-h" className="sr-only">{q ? `Courses matching “${q}”` : "Courses"}</h2>
          <p className="muted small" role="status">{q ? `${courses.length} course${courses.length === 1 ? "" : "s"} match “${q}”.` : `${courses.length} course${courses.length === 1 ? "" : "s"} available.`}</p>
          <ul className="course-grid">
            {courses.map((c) => (
              <li key={c.id} className="course-card">
                <div className="title-row">
                  <span className="title"><Link href={`/courses/${c.slug}`}>{c.code} · {c.title}</Link></span>
                  {c.isDemo && <span className="badge demo">Demo course</span>}
                </div>
                <p className="small muted">{c.universityName} · {c.subject}</p>
                <p className="small counts">
                  <b>{c.reviewedCount}</b> student-reviewed · <b>{c.unreviewedCount}</b> unreviewed
                  {c.topicMatches.length > 0 && <span className="muted"> · topic match: {c.topicMatches.join(", ")}</span>}
                </p>
                <Link className="btn small secondary go" href={`/practice/setup?course=${c.slug}`}>Start practice</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section>
          <div className="notice" role="status">
            {q ? (
              <>No course matches “{q}” yet.{all.length ? " Try a different search or browse all courses." : ""}</>
            ) : (
              <>No courses have been added yet. OpenFrame starts empty until reviewed content is supplied by volunteers.</>
            )}
          </div>
          {q && all.length > 0 && <p><Link href="/">Browse all courses</Link></p>}
        </section>
      )}

      <details id="request" className="request" open={courses.length === 0}>
        <summary>Don’t see your course? Request it</summary>
        <div className="request-body">
          <CourseRequestForm initialCode={courses.length === 0 ? q : ""} />
        </div>
      </details>
      <p className="muted small after-request">Or <Link href="/contribute">contribute questions</Link> for courses that already exist.</p>
    </>
  );
}
