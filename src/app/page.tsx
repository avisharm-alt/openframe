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
        <h1>What are you studying?</h1>
        <p className="muted">Find student-written practice questions for your course, with an explanation for every option. Free, student-run, and no account needed.</p>
        <form role="search" className="search" action="/" method="get">
          <label htmlFor="q" className="sr-only">Search courses and topics</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="e.g. DEMO-102, statistics, recursion" autoComplete="off" />
          <button className="btn">Search</button>
        </form>
      </section>

      {courses.length > 0 ? (
        <section aria-labelledby="results-h">
          <h2 id="results-h" className="sr-only">{q ? `Courses matching “${q}”` : "Courses"}</h2>
          <p className="muted small" role="status">{q ? `${courses.length} course${courses.length === 1 ? "" : "s"} match “${q}”.` : `${courses.length} course${courses.length === 1 ? "" : "s"} available.`}</p>
          <div className="grid">
            {courses.map((c) => (
              <article key={c.id} className="card">
                <p className="small muted" style={{ margin: 0 }}>
                  {c.universityName} {c.isDemo && <span className="badge demo">Demo course</span>}
                </p>
                <h3 style={{ margin: "0.2rem 0" }}><Link href={`/courses/${c.slug}`}>{c.code} · {c.title}</Link></h3>
                <p className="small muted">{c.subject}</p>
                <p className="small">
                  <b>{c.reviewedCount}</b> student-reviewed · <b>{c.unreviewedCount}</b> unreviewed
                </p>
                {c.topicMatches.length > 0 && <p className="small muted">Topic match: {c.topicMatches.join(", ")}</p>}
                <Link className="btn small" href={`/practice/setup?course=${c.slug}`}>Start practice</Link>
              </article>
            ))}
          </div>
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

      <details id="request" style={{ marginTop: "2rem" }} open={courses.length === 0}>
        <summary>Don’t see your course? Request it</summary>
        <div style={{ marginTop: "0.6rem" }}>
          <CourseRequestForm initialCode={courses.length === 0 ? q : ""} />
        </div>
      </details>
      <p className="muted small">Or <Link href="/contribute">contribute questions</Link> for courses that already exist.</p>
    </>
  );
}
