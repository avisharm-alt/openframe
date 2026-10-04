import Link from "next/link";
export const metadata = { title: "About" };
export default function About() {
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>About OpenFrame</h1>
      <p>
        OpenFrame is a free, open-source, nonprofit-oriented, student-run question bank, with university directories for Western University and the University of Toronto. Students find original, student-contributed,
        AI-assisted multiple-choice practice questions organised by course and topic, each with an explanation for every option.
      </p>
      <h2>What it is not</h2>
      <ul>
        <li><b>Independent.</b> OpenFrame is not affiliated with or endorsed by any university or instructor, and does not use university logos or seals.</li>
        <li><b>Not official.</b> Questions are not official exam questions and are not aligned to any current syllabus or assessment. Check explanations against your course materials.</li>
        <li><b>Not a predictor.</b> Practice scores do not predict exam results.</li>
        <li><b>Not a charity (yet).</b> We describe ourselves as a nonprofit-oriented initiative and make no claim of registered charitable status.</li>
        <li><b>No monetisation.</b> There are no subscriptions, ads, paid tiers, payment processing, or sale of user data.</li>
      </ul>
      <h2>How questions get here</h2>
      <p>
        Students write or generate questions (often with their own AI tools), check them, and submit them as structured text.
        Many of the questions in the bank so far are AI-generated and published <b>unverified</b>. A question is labelled <b>Verified</b> only after two different student reviewers, neither of them
        the author, have each worked out the answer for themselves and checked it against a review checklist. The label shows who verified it and when. Verification is not expert or instructor
        approval and does not guarantee accuracy. Practice uses verified questions by default; you can choose to include unverified ones. Anyone can report a problem
        on any question, and moderators can withdraw content promptly.
      </p>
      <h2>Licensing</h2>
      <p>
        Application code is proposed to be released under the MIT license. Accepted original questions are proposed to be shared under <b>CC BY 4.0</b>, credited to “OpenFrame contributors”;
        the project owner has yet to confirm this, and real submissions are not opened until that is settled. The AI-generated Western starter questions are not covered by that proposal until their
        source and ownership are settled. An AI-provenance label does not by itself establish ownership.
        See <code>LICENSE</code> and <code>docs/CONTENT-LICENSE.md</code> in the repository.
      </p>
      <p>See also: <Link href="/guidelines">contribution guidelines</Link>, <Link href="/academic-integrity">academic integrity</Link>, <Link href="/privacy">privacy</Link>, <Link href="/content-removal">content removal</Link>.</p>
    </div>
  );
}
