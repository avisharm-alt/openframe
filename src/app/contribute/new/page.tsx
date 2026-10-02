import Link from "next/link";
import { currentActor } from "@/lib/session";
import { contributionTargets } from "@/lib/services/catalog";
import { ContributionEditor } from "@/components/ContributionEditor";

export const metadata = { title: "New question" };

export default async function NewQuestion() {
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to contribute.</div>;
  const targets = contributionTargets();
  return (
    <>
      <h1>New question</h1>
      {targets.length === 0 ? <div className="notice warn">No courses are open for contributions yet.</div> : <ContributionEditor targets={targets} initial={null} />}
    </>
  );
}
