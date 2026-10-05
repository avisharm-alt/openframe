import Link from "next/link";
import { PARTNER_NOTICE } from "@/lib/copy";

export const metadata = { title: "About" };

export default function About() {
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>About OpenFrame</h1>
      <p>
        OpenFrame is a free, open-source, student-run network that keeps care packages for people experiencing homelessness stocked, all year round. Student teams in <b>London, Ontario (Western)</b> and
        <b> Oshawa, Ontario (Ontario Tech)</b> post exactly what they need. Neighbours pledge items they already have and either hand them to us at a public drop-off zone or ask for a pickup at their door. The
        team counts the items in, assembles packages, and hands them out through partner agencies.
      </p>
      <h2>How it works</h2>
      <ol>
        <li><b>See the live needs.</b> Each chapter’s board updates from its package templates and current stock, so it is always current. No drives, no stale lists.</li>
        <li><b>Pledge what you have.</b> Sign in, choose items and quantities from open needs, then pick a pickup or a drop-off. We only ask for what is on the list.</li>
        <li><b>We collect, count and assemble.</b> Two volunteers do every pickup. Coordinators count what actually arrived into stock, assemble packages from a template, and hand them to partner agencies.</li>
        <li><b>You see the impact.</b> The <Link href="/impact">impact page</Link> shows packages handed off per week, items received and active volunteers, as counts only.</li>
      </ol>
      <h2>What we never do</h2>
      <ul>
        <li><b>We never record the people who receive packages.</b> No names, descriptions or locations. We record only which partner agency received a package and on what date.</li>
        <li><b>We never ask for money, take payments or show ads.</b> We do not sell or share data.</li>
        <li><b>We never share your address broadly.</b> A pickup address is encrypted, visible only to you, your chapter’s coordinators and the two volunteers assigned, from 24 hours before the window, and erased after the pickup. See <Link href="/privacy">Privacy</Link> and <Link href="/safety">Safety</Link>.</li>
      </ul>
      <h2>Independent and open</h2>
      <p>
        OpenFrame is independent: it is not affiliated with or endorsed by any university, and it is not a registered charity. The application code is released under the MIT license. Chapters are data, not code, so any
        campus can start one: see <code>docs/START-A-CHAPTER.md</code> in the repository.
      </p>
      <h2>Partner agencies</h2>
      <p>{PARTNER_NOTICE}</p>
      <p>See also: <Link href="/guidelines">guidelines</Link>, <Link href="/safety">safety</Link>, <Link href="/privacy">privacy</Link>.</p>
    </div>
  );
}
