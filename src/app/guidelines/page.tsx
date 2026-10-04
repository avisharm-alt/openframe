import Link from "next/link";
import { config } from "@/lib/config";
import { LICENSE_NOTE } from "@/lib/copy";
export const metadata = { title: "Contribution guidelines" };
export default function Guidelines() {
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>Contribution guidelines</h1>
      {config.notesUploadsEnabled && (
        <>
          <h2>Uploading course notes</h2>
          <p><Link href="/course-notes">Upload course notes</Link> as PDF or plain text files up to 10 MB. Upload <b>your own</b> notes only: not instructor slides, handouts, readings, lecture recordings or past tests and quizzes, and nothing with exam or quiz questions or personal information. Files are private to you and the OpenFrame review team; uploading does not publish them or automatically generate questions.</p>
        </>
      )}
      <h2>What a good question looks like</h2>
      <ul>
        <li>Original wording, tied to a specific course topic and a specific learning objective.</li>
        <li>Four or five distinct options, exactly one defensible correct answer.</li>
        <li>An explanation for the correct answer <i>and</i> for each distractor, written so each stands on its own.</li>
        <li>Prefer application, interpretation and conceptual understanding over recall.</li>
        <li>Avoid trick wording, needless negatives, an obviously longer correct answer, overlapping options, and “all/none of the above”.</li>
        <li>Options are shuffled, so nothing may depend on option position (“both A and B”).</li>
      </ul>
      <h2>Provenance and checking</h2>
      <ul>
        <li>State whether the question is AI-generated or AI-assisted. Name the tool and date only if you actually know them. Never invent them.</li>
        <li>Describe how you checked the answer. AI output must be checked by a person.</li>
        <li>References are optional. Cite only what you are allowed to share; do not fabricate sources. OpenFrame never fetches or verifies links.</li>
      </ul>
      <h2>Rules</h2>
      <ul>
        <li>No professor-created exams, quizzes, tests, answer keys, screenshots, scans, copied or reconstructed questions. See <Link href="/academic-integrity">academic integrity</Link>.</li>
        <li><b>Write against the public syllabus and learning outcomes.</b> Base questions on the course outline, published learning outcomes and standard textbook-level knowledge of the subject. Never derive questions from an instructor&apos;s slides, handouts, notes, recordings, problem sets or exam material unless the instructor has given you permission, and say so when you submit.</li>
        <li>Question drafts accept structured text only{config.notesUploadsEnabled ? "; course notes use the separate upload form" : ""}. Markdown and LaTeX are supported in questions; HTML, scripts and images are not.</li>
        <li>You must confirm the originality and permission statement on every submission.</li>
        <li>Questions you contribute are proposed to be shared under CC BY 4.0. {LICENSE_NOTE} See <code>docs/CONTENT-LICENSE.md</code>.</li>
        <li>Course association does not give you permission to reproduce lecture slides, textbook questions, or other protected material.</li>
      </ul>
      <h2>Review and verification</h2>
      <p>
        Nothing is published immediately. Two different students review each submission against a checklist: each must have worked out the answer for themselves before looking at the key, and checks the
        attestation, mapping, one defensible answer, correct explanations, plausible distractors, no actual assessment or instructor-material content, and no unsupported references.
        Only after both approve is a question published and labelled <b>Verified</b>, showing who verified it and when. Reviewers&apos; display names are shown publicly on the questions they verify.
        You can see the status and any requested changes. Edits to a published question, including corrections by a reviewer, create a new revision that is reviewed again; the approved version stays live meanwhile.
        You cannot review a question you wrote or edited.
      </p>
    </div>
  );
}
