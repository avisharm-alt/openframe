import Link from "next/link";
import { ACCEPTED, NEW_ONLY_NOTE, NOT_ACCEPTED } from "@/lib/copy";

export const metadata = { title: "Guidelines" };

export default function Guidelines() {
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>Guidelines</h1>
      <p className="muted">How we ask everyone to take part. These apply to neighbours, partners, volunteers and coordinators.</p>

      <h2>For neighbours</h2>
      <h3>What we accept</h3>
      <ul>{ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul>
      <p className="small muted">{NEW_ONLY_NOTE}</p>
      <h3>What we can’t accept</h3>
      <ul>{NOT_ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul>
      <ul>
        <li>Claim only what you will really give, in the size asked for. A partial claim (some of the quantity) is welcome. If your plans change, cancel or reschedule from <Link href="/claims">My claims</Link>.</li>
        <li>A pickup claim must be scheduled within 48 hours or it goes back on the board. You can have at most 3 open pickup claims at a time. Drop-offs have no such limit.</li>
        <li>Be at the door during your window and hand items over at the door. Volunteers will not come inside.</li>
        <li>Treat volunteers respectfully. If anyone makes you uncomfortable, report a concern from My claims.</li>
      </ul>

      <h2>For partners (agency workers)</h2>
      <h3>How to write a good anonymous request</h3>
      <ul>
        <li><b>Ask for the item, not the person.</b> “Men’s winter boots, size 11” is right. Never write a name, a description of someone, their health, where they stay or any story that could identify them. The form blocks the most obvious cases, but you are responsible for the rest.</li>
        <li><b>Be specific:</b> item, size, how many, and a needed-by date. Pick “urgent” only when waiting would cause real harm.</li>
        <li><b>Choose the delivery site</b> where your staff will receive it, and keep its receiving hours up to date.</li>
        <li><b>Confirm receipt</b> as soon as the delivery arrives. That is what closes the loop and starts the clock for our impact numbers.</li>
        <li>Use “repeat last request” and favourites for the things you ask for often.</li>
        <li>Items must be things your agency can hand out safely. See your partnership note for what you have told us you do not accept.</li>
      </ul>

      <h2>For volunteers</h2>
      <ul>
        <li>Read and acknowledge the <Link href="/safety">Safety rules</Link> before your first shift. They are not optional.</li>
        <li>Always go in pairs, in daytime, and never inside a home. Leave whenever you feel unsafe.</li>
        <li>Deliver to agency staff only. Never deal with the people who receive items, and never record, photograph or describe them.</li>
        <li>Keep every address private. Do not copy, photograph or share it.</li>
        <li>Check in and out with the buttons in My shifts, so coordinators know you are safe.</li>
      </ul>

      <h2>For coordinators</h2>
      <ul>
        <li>Verify partners and their workers properly (a call or visit, and a one-page partnership note) before approving them.</li>
        <li>Triage requests daily: fill what the shelf covers, and keep restock targets realistic.</li>
        <li>Count donations accurately and discard anything unsafe or unusable, with a note.</li>
        <li>Never enter anything about the people who receive items. Deliveries record the partner, the site and the date only.</li>
        <li>Review concern reports promptly, safety concerns first.</li>
        <li>Add only people you know and trust as volunteers, and remind them of the Safety rules.</li>
      </ul>

      <h2>Everyone</h2>
      <p>
        Be respectful and assume good faith. No harassment, discrimination, threats or personal attacks. Speak about people experiencing homelessness with dignity: they are our neighbours. Our full
        expectations are in the Code of Conduct in the repository. Report problems through a concern report or the contact on the <Link href="/privacy">Privacy page</Link>.
      </p>
    </div>
  );
}
