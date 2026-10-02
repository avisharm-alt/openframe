import Link from "next/link";
export const metadata = { title: "About" };
export default function About() {
  return (
    <div className="prose">
      <h1>About OpenFrame</h1>
      <p>
        OpenFrame is a free, open-source, nonprofit-oriented, student-run question bank, starting at Western University. Students find original, student-contributed,
        AI-assisted multiple-choice practice questions organised by course and topic, each with an explanation for every option.
      </p>
      <h2>What it is not</h2>
      <ul>
        <li><b>Independent.</b> OpenFrame is not affiliated with or endorsed by Western University or any instructor, and does not use university logos or seals.</li>
        <li><b>Not official.</b> Questions are not official exam questions and are not aligned to any current syllabus or assessment. Check explanations against your course materials.</li>
        <li><b>Not a predictor.</b> Practice scores do not predict exam results.</li>
        <li><b>Not a charity (yet).</b> We describe ourselves as a nonprofit-oriented initiative and make no claim of registered charitable status.</li>
        <li><b>No monetisation.</b> There are no subscriptions, ads, paid tiers, payment processing, or sale of user data.</li>
      </ul>
      <h2>How questions get here</h2>
      <p>
        Students write or generate questions (often with their own AI tools), check them, and submit them as structured text. Another student reviews each submission against a
        checklist before it is published. “Student-reviewed” means another student checked it; it is not expert verification and does not guarantee accuracy. Anyone can report a problem
        on any question, and moderators can withdraw content promptly.
      </p>
      <h2>Licensing</h2>
      <p>
        Application code is proposed to be released under the MIT license. Accepted original questions are intended to be shared under a separately stated content license that the
        project owner has yet to confirm; real submissions are not opened until that is settled. An AI-provenance label does not by itself establish ownership.
        See <code>LICENSE</code> and <code>docs/CONTENT-LICENSE.md</code> in the repository.
      </p>
      <p>See also: <Link href="/guidelines">contribution guidelines</Link>, <Link href="/academic-integrity">academic integrity</Link>, <Link href="/privacy">privacy</Link>, <Link href="/content-removal">content removal</Link>.</p>
    </div>
  );
}
