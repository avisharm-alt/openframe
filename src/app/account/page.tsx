import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { DeleteAccount } from "@/components/AccountActions";
import { DisplayNameForm } from "@/components/AuthForms";

export const metadata = { title: "Account" };

export default async function Account({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in");
  const welcome = (await searchParams).welcome === "1";
  return (
    <>
      <h1>Account</h1>
      {welcome && (
        <p className="notice good" role="status">
          Welcome! We gave you a random display name. You can keep it or change it below. We did not keep your Google name or photo.
        </p>
      )}
      <p>Role: {actor.role}</p>
      <h2>Display name</h2>
      <DisplayNameForm initial={actor.name ?? ""} />
      <h2>Delete account</h2>
      <p>
        Deleting your account removes your sign-in, bookmarks, practice history, drafts and unpublished submissions. Questions that were already accepted and published
        stay in the bank under the content license, but are detached from your account and shown without attribution. To remove a published question yourself, delete it from the Contribute page before deleting your account. Reports you filed keep their text but lose the link to you.
        To also remove OpenFrame’s access from Google’s side, visit your Google Account’s “Third-party access” page.
      </p>
      <DeleteAccount />
    </>
  );
}
