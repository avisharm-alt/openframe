import { notFound } from "next/navigation";
import { getCourse } from "@/lib/services/catalog";
import { SetupForm } from "@/components/SetupForm";
import { ServiceError } from "@/lib/errors";

export const metadata = { title: "Practice setup" };

export default async function Setup({ searchParams }: { searchParams: Promise<{ course?: string; unverified?: string }> }) {
  const sp = await searchParams;
  if (!sp.course) notFound();
  let course;
  try {
    course = getCourse(sp.course);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
      <h1>Practice: {course.code}</h1>
      <p className="muted">{course.title} · {course.verifiedCount} of {course.totalCount} questions verified</p>
      <SetupForm
        course={{ id: course.id, code: course.code, title: course.title, slug: course.slug }}
        units={course.units}
        defaultUnverified={sp.unverified === "1"}
      />
    </>
  );
}
