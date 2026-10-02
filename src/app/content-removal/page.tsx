import { config } from "@/lib/config";
import { RemovalForm } from "@/components/RemovalForm";
export const metadata = { title: "Content removal" };
export default function Removal() {
  const contact = config.contentRemovalContact;
  const isLink = /^(https?:|mailto:)/i.test(contact);
  return (
    <div style={{ maxWidth: "44rem" }}>
      <h1>Content removal</h1>
      <p>
        If something here should not be on OpenFrame — for example material copied or reconstructed from an actual university assessment, content you own, or an error — tell us.
        Requests go to a priority queue and a moderator will review them. Withdrawn questions are removed from new sessions and public responses promptly.
      </p>
      <h2>Contact</h2>
      {contact ? (
        <p>{isLink ? <a href={contact} rel="noopener noreferrer">{contact.replace(/^mailto:/i, "")}</a> : contact}</p>
      ) : (
        <p className="notice warn">The maintainers have not configured a public contact route yet. Until they do, use the form below or the “Report a problem” button on any question.</p>
      )}
      <h2>Send a removal request</h2>
      <RemovalForm />
      <p className="small muted">A single request does not delete content automatically; moderators verify and act. Please do not paste the material itself — describe where it appears.</p>
    </div>
  );
}
