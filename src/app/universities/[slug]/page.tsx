import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseList } from "@/components/CourseList";
import { CourseRequestForm } from "@/components/CourseRequestForm";
import { getUniversity, listCourses } from "@/lib/services/catalog";
import { ServiceError } from "@/lib/errors";

export default async function UniversityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let university;
  try {
    university = getUniversity(slug);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) notFound();
    throw error;
  }
  const courses = listCourses("", slug);

  return (
    <>
      <p className="small"><Link href="/">← Universities</Link></p>
      <section className="hero university-hero">
        <p className="eyebrow">University course directory</p>
        <h1>{university.name}</h1>
        <p className="muted">Browse courses and student-contributed practice questions for {university.name}.</p>
      </section>
      <section className="course-section" aria-labelledby="university-courses-h">
        <div className="course-section-heading">
          <h2 id="university-courses-h">Courses</h2>
          <p className="muted small">{courses.length} course{courses.length === 1 ? "" : "s"} available</p>
        </div>
        {courses.length > 0 ? (
          <CourseList courses={courses} />
        ) : (
          <div className="notice" role="status">No courses have been added for {university.name} yet. You can request one below.</div>
        )}
      </section>
      <details id="request" style={{ marginTop: "2rem" }} open={courses.length === 0}>
        <summary>Don’t see your course? Request it</summary>
        <div style={{ marginTop: "0.6rem" }}><CourseRequestForm universitySlug={slug} /></div>
      </details>
    </>
  );
}
