import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { DeleteAccount } from "@/components/AccountActions";

export const metadata = { title: "Account" };

export default async function Account() {
  const actor = await currentActor();
  if (!actor) redirect("/auth/sign-in");
  return (
    <>
      <h1>Account</h1>
      <p>Signed in as <b>{actor.name}</b> · role: {actor.role}</p>
      <h2>Delete account</h2>
      <p>
        Deleting your account removes your sign-in, bookmarks, practice history, drafts and unpublished submissions. Questions that were already accepted and published
        stay in the bank under the content license, but are detached from your account and shown without attribution. Reports you filed keep their text but lose the link to you.
      </p>
      <DeleteAccount />
    </>
  );
}
