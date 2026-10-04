import Link from "next/link";
import type { CourseSummary } from "@/lib/services/catalog";

export function CourseList({ courses, showUniversity = false }: { courses: CourseSummary[]; showUniversity?: boolean }) {
  return (
    <ul className="listing">
      {courses.map((c) => (
        <li key={c.id}>
          <div className="course-details">
            <div className="course-title-row">
              <span className="title"><Link href={`/courses/${c.slug}`} aria-label={`${c.code} · ${c.title}`}><span className="course-code">{c.code}</span><span className="course-title">{c.title}</span></Link></span>
              {c.isDemo && <span className="badge demo">Demo course</span>}
            </div>
            <p className="small muted course-meta">{showUniversity && <>{c.universityName} <span aria-hidden="true">/</span> </>}{c.subject}</p>
            <p className="small course-counts">
              <span><b>{c.verifiedCount}</b> of <b>{c.totalCount}</b> question{c.totalCount === 1 ? "" : "s"} verified</span>
              {c.topicMatches.length > 0 && <span className="muted"> · topic match: {c.topicMatches.join(", ")}</span>}
            </p>
          </div>
          <Link className="course-action" href={`/practice/setup?course=${c.slug}`}>Start practice <span aria-hidden="true">→</span></Link>
        </li>
      ))}
    </ul>
  );
}
