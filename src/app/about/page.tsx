import Link from "next/link";
import { PARTNER_NOTICE } from "@/lib/copy";

export const metadata = { title: "About" };

export default function About() {
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>About OpenFrame</h1>
      <p>
        OpenFrame is a free, open-source, student-run link between <b>community partners</b> and <b>neighbours</b>. Frontline workers at partner agencies post the specific things the people they serve need
        (“men’s winter boots, size 11, by Friday”). A neighbour who has them claims the request. Student teams in <b>London, Ontario (Western)</b> and <b>Oshawa, Ontario (Ontario Tech)</b> collect the item, or
        take it from a drop-off zone, and deliver it to the agency. Agency staff hand it to the person. Our goal is to get an item from request to delivery in under 72 hours.
      </p>
      <h2>How it works</h2>
      <ol>
        <li><b>Partners ask.</b> A verified agency worker posts a request in under 30 seconds: the item, size, how many, when it is needed and where to deliver it. Requests are anonymous and never describe a person.</li>
        <li><b>Neighbours claim.</b> Sign in, pick a request from the live <Link href="/">board</Link> and choose how to hand it over: a pickup from your address, or a drop-off at a public zone. If a pickup is not scheduled in time, the request goes back on the board.</li>
        <li><b>Students move it.</b> Two volunteers do every pickup. A small shelf of common essentials lets us fill many requests the same day. Student teams deliver to the agency in batches on weekly shifts.</li>
        <li><b>Partners confirm, and you see the result.</b> The agency confirms receipt, and your claim shows “Delivered to [agency] on [date]”. The <Link href="/impact">impact page</Link> leads with the median time from request to delivery.</li>
      </ol>
      <h2>What we never do</h2>
      <ul>
        <li><b>We never record the people who receive items.</b> No names, descriptions or locations. A request records only the partner, the delivery site and the item.</li>
        <li><b>Students never deal with recipients.</b> We deliver to agency staff, who hand items to the person.</li>
        <li><b>We never ask for money, take payments or show ads.</b> We do not sell or share data.</li>
        <li><b>We never share your address broadly.</b> A pickup address is encrypted, visible only to you, your chapter’s coordinators and the two volunteers assigned, from 24 hours before the window, and erased after the pickup. See <Link href="/privacy">Privacy</Link> and <Link href="/safety">Safety</Link>.</li>
      </ul>
      <h2>Independent and open</h2>
      <p>
        OpenFrame is independent: it is not affiliated with or endorsed by any university, and it is not a registered charity. The application code is released under the MIT license. Chapters and partners are data,
        not code, so any campus can start a chapter: see <code>docs/START-A-CHAPTER.md</code> and <code>docs/PARTNER-ONBOARDING.md</code> in the repository.
      </p>
      <h2>Partner agencies</h2>
      <p>{PARTNER_NOTICE}</p>
      <p>See also: <Link href="/guidelines">guidelines</Link>, <Link href="/safety">safety</Link>, <Link href="/privacy">privacy</Link>, <Link href="/partner">for partners</Link>.</p>
    </div>
  );
}
