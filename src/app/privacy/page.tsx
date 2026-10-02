import { config } from "@/lib/config";
import { NOTES_RETENTION_DAYS } from "@/lib/attestation";
export const metadata = { title: "Privacy" };
export default function Privacy() {
  const sec = config.securityContact;
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>Privacy</h1>
      <p>This is a plain description of what the software does. It is not legal advice and does not by itself guarantee compliance with any law.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Guests:</b> practice sessions are stored on the server under a random identifier so answers can be scored, and a list of those identifiers is kept in your browser. Guest sessions are deleted after a retention period set by the maintainers (30 days by default).</li>
        <li><b>Accounts:</b> you sign in with Google. We store your email address and Google’s account identifier, a random display name (changeable; use a pseudonym), and your practice history and bookmarks. We discard the real name and profile photo Google provides, we do not store a password, and we do not collect student numbers or grades. We request only the basic sign-in permissions (email and profile) and never post to your Google account. Google learns that you use OpenFrame, under Google’s own privacy policy. The tokens Google issues are stored encrypted and are not otherwise used.</li>
        <li><b>Shared notes (optional):</b> if you send notes, we store the text and any files you attach, the course and title, which account sent them, and the consent you gave. They are never shown to other students or published, and only OpenFrame maintainers can read them. Maintainers may use them, including by putting them into third-party AI tools as you agreed, to write practice questions; those tools have their own terms and may keep what they receive, which we cannot control. Files are stored on the server’s disk, are not opened or processed there, and are not checked for personal details, so check them before sending. Notes are deleted automatically {NOTES_RETENTION_DAYS} days after you send them, or sooner when you or a maintainer delete them or you delete your account. Files are kept out of routine database backups; a copy in a volume-level backup, if the host takes one, disappears when that backup is replaced.</li>
        <li><b>Contributions:</b> the question text and metadata you submit, your attestation, and review records. Public attribution is optional and off by default.</li>
        <li><b>Reports and course requests:</b> the text you send. For anonymous reports we store a keyed hash of your network address, only to limit spam and duplicate reports; the address itself is not stored.</li>
        <li><b>Cookies:</b> a session cookie when you sign in. Browser storage keeps guest history on your device. No advertising or tracking cookies are used.</li>
      </ul>
      <h2>What we do not do</h2>
      <p>No ads, no analytics sold to anyone, no sale or sharing of user data. We do not fetch links contributors provide.</p>
      <h2>Your data</h2>
      <ul>
        <li><b>Clear this device:</b> “Clear history on this device” on the Saved &amp; history page removes local history and deletes those guest sessions.</li>
        <li><b>Delete your account:</b> from the Account page. This removes your sign-in, history, bookmarks, drafts, unpublished submissions, and any shared notes and their files. Published questions remain in the bank under the content license, detached from your account and without attribution; you can delete any question you wrote from the Contribute page first, which permanently erases its text. Reports you filed keep their text without your link.</li>
        <li><b>Moderation records:</b> restricted audit events (what action, on which question, when) are kept for moderation. They hold no private reviewer notes or personal data beyond a reference to the acting moderator’s account, which is removed when that account is deleted.</li>
      </ul>
      <h2>Security</h2>
      <p>{sec ? <>Report vulnerabilities to <code>{sec}</code>.</> : <>The maintainers have not configured a security contact yet. See <code>SECURITY.md</code> in the repository.</>}</p>
    </div>
  );
}
