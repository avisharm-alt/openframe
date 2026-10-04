import Link from "next/link";
import { listCourses, listUniversities } from "@/lib/services/catalog";
import { CourseRequestForm } from "@/components/CourseRequestForm";
import { CourseList } from "@/components/CourseList";
import { config } from "@/lib/config";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const universities = listUniversities();
  const courses = q ? listCourses(q) : [];
  const all = q ? listCourses() : [];
  return (
    <>
      <section className="hero">
        <h1>Find your courses</h1>
        <p className="muted">Choose your university to browse its courses and practice questions, or search across all courses.</p>
        <form role="search" className="search" action="/" method="get">
          <label htmlFor="q" className="search-label">Search courses and topics</label>
          <div className="search-controls">
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Course code, title, or topic" autoComplete="off" />
            <button className="btn">Search</button>
          </div>
        </form>
      </section>

      {!q && (
        <section className="course-section" aria-labelledby="universities-h">
          <div className="course-section-heading">
            <h2 id="universities-h">Universities</h2>
            <p className="muted small">{universities.length} available</p>
          </div>
          <div className="university-grid">
            {universities.map((u) => (
              <Link className="university-panel" href={`/universities/${u.slug}`} key={u.slug}>
                <span className="university-panel-index">{u.slug === "uoft" ? "U OF T" : u.slug.toUpperCase()}</span>
                <span className="university-panel-name">{u.name}</span>
                <span className="university-panel-foot"><span>{u.courseCount} course{u.courseCount === 1 ? "" : "s"}</span><span aria-hidden="true">→</span></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {q && courses.length > 0 ? (
        <section className="course-section" aria-labelledby="results-h">
          <div className="course-section-heading">
            <h2 id="results-h">Courses matching “{q}”</h2>
            <p className="muted small" role="status">{courses.length} course{courses.length === 1 ? "" : "s"} found</p>
          </div>
          <CourseList courses={courses} showUniversity />
        </section>
      ) : q ? (
        <section>
          <div className="notice" role="status">
            No course matches “{q}” yet.{all.length ? " Try a different search or browse by university." : ""}
          </div>
          <p><Link href="/">Browse universities</Link></p>
        </section>
      ) : null}

      <details id="request" style={{ marginTop: "2rem" }} open={!!q && courses.length === 0}>
        <summary>Don’t see your course? Request it</summary>
        <div style={{ marginTop: "0.6rem" }}>
          <CourseRequestForm initialCode={q && courses.length === 0 ? q : ""} universities={universities} />
        </div>
      </details>
      {config.notesUploadsEnabled && <p className="muted small">Or <Link href="/course-notes">upload your own course notes</Link> for courses that already exist.</p>}
    </>
  );
}
