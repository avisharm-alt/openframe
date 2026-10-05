import { config } from "@/lib/config";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  const sec = config.securityContact;
  const contact = config.contact;
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>Privacy</h1>
      <p>This is a plain description of what the software does. It is not legal advice and does not by itself guarantee compliance with any law.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Browsing:</b> you can see the live request board, drop-off zones and impact numbers without an account. No advertising or tracking cookies are used.</li>
        <li><b>Accounts:</b> you sign in with Google. We store your email address and Google’s account identifier, and a random display name (changeable; please use a pseudonym). We discard the real name and profile photo Google provides, we do not store a password, and we request only the basic sign-in permissions. Google learns that you use OpenFrame, under Google’s own privacy policy. A session cookie keeps you signed in.</li>
        <li><b>Claims:</b> the request you claimed, the quantity, whether you chose a pickup or a drop-off, the zone and date, status and timestamps. This is kept so chapters can count what arrived and measure delivery times; after you delete your account it stays only as an anonymous record.</li>
        <li><b>Agency workers:</b> the partner you work for, your approval status, the requests you post (item, size, quantity, needed-by date, delivery site and a short public note) and your favourites. Notes must never identify a person.</li>
        <li><b>Pickup details:</b> your address, access notes and phone number (phone and notes optional), and your preferred windows. The address, notes and phone are <b>encrypted</b> in the database. They are shown only to you, the coordinators of that chapter and the two volunteers assigned to the pickup, from {config.pickupVisibleHoursBefore} hours before the window until the pickup is closed. <b>Every view is recorded in an audit log</b> (who and when, never the address). They are <b>erased {config.pickupPurgeDays} days</b> after the claim is collected, cancelled or a no-show, and immediately if you delete your account. Windows (dates and times) are kept.</li>
        <li><b>Volunteers and coordinators:</b> your chapter role, the date you acknowledged the Safety rules, your assignments, check-in and check-out times and outcomes. Coordinators of your chapter can see your display name and sign-in email.</li>
        <li><b>Concern reports:</b> the text of any report you file or that is filed about a pickup you were part of, visible to the chapter’s coordinators.</li>
        <li><b>Audit log:</b> an append-only record of actions such as role changes, partner approvals, address views and deliveries. It holds no addresses, phone numbers or notes.</li>
        <li><b>Emails:</b> if email is configured on this site, you receive messages about your own claims, requests and assignments. They never contain your address.</li>
      </ul>

      <h2>What we never record</h2>
      <p>
        <b>The people who receive items.</b> There is no field for their names, descriptions or locations anywhere in the system. A request and its delivery record only the partner agency, the delivery site, the item and the dates, nothing more.
      </p>
      <p>No ads, no analytics sold to anyone, no sale or sharing of user data.</p>

      <h2>Your data</h2>
      <ul>
        <li><b>Delete your account</b> from the Account page. This cancels your open claims, erases any pickup address, notes and phone you entered, releases your open volunteer assignments, and removes your sign-in and chapter roles. Counts such as received items and delivery times stay, detached from you. Backups may retain removed data until the maintainer’s backup retention period ends.</li>
        <li><b>Questions or removal requests:</b> {contact ? <>contact <code>{contact}</code>.</> : <>the maintainers have not configured a public contact yet. Until they do, ask your chapter coordinator.</>}</li>
      </ul>

      <h2>Security</h2>
      <p>{sec ? <>Report vulnerabilities to <code>{sec}</code>.</> : <>The maintainers have not configured a security contact yet. See <code>SECURITY.md</code> in the repository.</>}</p>
    </div>
  );
}
