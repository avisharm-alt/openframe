import Link from "next/link";
export const metadata = { title: "Contribution guidelines" };
export default function Guidelines() {
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>Contribution guidelines</h1>
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
        <li>No file uploads. Submit structured text only. Markdown and LaTeX are supported; HTML, scripts and images are not.</li>
        <li>You must confirm the originality and permission statement on every submission.</li>
        <li>Course association does not give you permission to reproduce lecture slides, textbook questions, or other protected material.</li>
      </ul>
      <h2>Review</h2>
      <p>
        Nothing is published immediately. Another student reviews against a checklist (attestation, mapping, one defensible answer, correct explanations, plausible distractors, no actual assessment
        content, no unsupported references). You can see the status and any requested changes. Edits to a published question create a new revision that is reviewed again; the approved version stays live meanwhile.
        You cannot review your own submissions.
      </p>
    </div>
  );
}
