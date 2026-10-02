import Link from "next/link";
import { currentActor } from "@/lib/session";
import { contributionTargets } from "@/lib/services/catalog";
import { listMyNotes } from "@/lib/services/notes";
import { MyNotes, NotesForm } from "@/components/NotesForm";

export const metadata = { title: "Share your notes" };

export default async function ShareNotes() {
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to share notes.</div>;
  const courses = contributionTargets().map((t) => ({ id: t.id, code: t.code, title: t.title, isDemo: t.isDemo }));
  return (
    <>
      <p className="small"><Link href="/contribute">← Contribute</Link></p>
      <h1>Share your notes</h1>
      <p>
        Have good notes for a course? Send them privately and volunteers may use them to write practice questions. Your notes are <b>never published or shown</b> to anyone
        else. Send files or paste text. Only send notes you wrote yourself: not slides, handouts, textbook text, or anything from a test, exam or graded assignment. See the <Link href="/privacy">privacy page</Link>.
      </p>
      <NotesForm courses={courses} />
      <h2>Your notes</h2>
      <MyNotes notes={listMyNotes(actor)} />
    </>
  );
}
