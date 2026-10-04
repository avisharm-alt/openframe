import Link from "next/link";
import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import { currentActor } from "@/lib/session";
import { listCourses } from "@/lib/services/catalog";
import { listCourseNotes } from "@/lib/services/course-notes";
import { CourseNotesUpload, RemoveCourseNote } from "@/components/CourseNotesUpload";

export const metadata = { title: "Upload course notes" };

export default async function CourseNotes() {
  if (!config.notesUploadsEnabled) notFound(); // feature flag: OPENFRAME_NOTES_UPLOADS
  const actor = await currentActor();
  const notes = actor ? listCourseNotes(actor) : [];
  return <>
    <h1>Upload course notes</h1>
    <p className="muted" style={{ maxWidth: "38rem" }}>Share <b>your own</b> notes to help OpenFrame develop practice questions. Please do not upload instructor slides, handouts, readings, lecture recordings or past tests and quizzes: those are usually copyrighted by the instructor or publisher. Files are private: only you and the OpenFrame review team can access them.</p>
    {!actor ? <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to upload your own course notes. PDF and plain text files are accepted, up to 10 MB each.</div> : <>
      <CourseNotesUpload courses={listCourses()} />
      <h2 style={{ marginTop: "2.5rem" }}>Your uploads</h2>
      {!notes.length ? <p className="muted">No notes uploaded yet.</p> : <ul className="plain-list">
        {notes.map((n) => <li key={n.id} style={{ marginBottom: "1rem" }}>
          <a href={"/api/course-notes/" + n.id}>{n.filename}</a>
          <p className="muted small">{n.courseCode} · {Math.ceil(n.sizeBytes / 1024)} KB · {n.createdAt.slice(0, 10)}</p>
          <RemoveCourseNote id={n.id} />
        </li>)}
      </ul>}
    </>}
    <p className="small muted">Need another course? <Link href="/#request">Request a course</Link>.</p>
  </>;
}
