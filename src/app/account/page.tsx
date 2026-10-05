import { redirect } from "next/navigation";
import Link from "next/link";
import { currentActor } from "@/lib/session";
import { listMemberships, listPartnerMemberships } from "@/lib/services/access";
import { DeleteAccount } from "@/components/AccountActions";
import { DisplayNameForm } from "@/components/AuthForms";
import { safeNext } from "@/lib/redirect";

export const metadata = { title: "Account" };

export default async function Account({ searchParams }: { searchParams: Promise<{ welcome?: string; next?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in");
  const sp = await searchParams;
  const welcome = sp.welcome === "1";
  const next = safeNext(sp.next);
  const memberships = listMemberships(actor.id);
  const partnerships = listPartnerMemberships(actor.id);
  return (
    <div style={{ maxWidth: "40rem" }}>
      <h1>Account</h1>
      {welcome && (
        <p className="notice good" role="status">
          Welcome! We gave you a random display name. You can keep it or change it below. We did not keep your Google name or photo.{next !== "/" && <> <Link href={next}>Continue where you were</Link>.</>}
        </p>
      )}
      <p>Role: {actor.role === "admin" ? "admin" : "member"}{memberships.length > 0 && <> · {memberships.map((m) => `${m.role} in ${m.name}`).join(", ")}</>}</p>
      {partnerships.length > 0 && (
        <p>Agency access: {partnerships.map((m) => `${m.name} (${m.status === "approved" ? "approved" : "waiting for a coordinator"})`).join(", ")}</p>
      )}
      <h2>Display name</h2>
      <DisplayNameForm initial={actor.name ?? ""} />
      <h2>Delete account</h2>
      <p>
        Deleting your account cancels your open claims (their requests go back on the board), immediately erases any pickup address, notes and phone number you entered, releases your open volunteer assignments and shifts, and removes your sign-in and chapter
        roles. Requests you posted stay for your partner, without your name. Counts of received items stay, detached from you. To also remove OpenFrame’s access from Google’s side, visit your Google Account’s “Third-party access” page.
      </p>
      <DeleteAccount />
    </div>
  );
}
