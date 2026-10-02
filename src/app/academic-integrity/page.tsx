export const metadata = { title: "Academic integrity" };
export default function Integrity() {
  return (
    <div className="prose">
      <h1>Academic integrity</h1>
      <p>OpenFrame exists to help students practise, not to circulate assessments.</p>
      <h2>We never accept actual university assessments</h2>
      <p>
        This includes professor-created exams, quizzes, tests and their answer keys, whether past or current, in any form: copies, screenshots, scans, reconstructions from memory, or lightly reworded versions.
        The rule applies even if an assessment has already been circulated publicly.
      </p>
      <h2>What this means in practice</h2>
      <ul>
        <li>Uploads of any kind (PDF, documents, images) are disabled in the interface and rejected by the API.</li>
        <li>Every submission is reviewed by a person before publication. Automatic keyword and duplicate checks may flag concerns for reviewers but cannot guarantee detection.</li>
        <li>Anyone can report a question as possibly containing assessment content. Such reports go to a priority queue for a moderator. One report never deletes content automatically; moderators withdraw content promptly when warranted.</li>
        <li>Withdrawn questions disappear from new sessions, search, bookmarks and public responses. If one is withdrawn during your session you will see an “unavailable” notice and it is excluded from your score.</li>
      </ul>
      <h2>Your responsibilities</h2>
      <p>Follow your course’s and university’s rules on collaboration and outside resources. Course association does not grant permission to reproduce lecture slides, textbook questions or other protected material. To request removal, see the content removal page.</p>
    </div>
  );
}
