import Link from "next/link";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/session";
import { contributionTargets } from "@/lib/services/catalog";
import { getMine } from "@/lib/services/contributions";
import { ContributionEditor, ContributionStatus } from "@/components/ContributionEditor";
import { ServiceError } from "@/lib/errors";
import { isMaintainer } from "@/lib/types";

export const metadata = { title: "Your question" };

export default async function EditQuestion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  if (!actor) return <div className="notice"><Link href="/auth/sign-in">Sign in</Link> to contribute.</div>;
  let c;
  try {
    c = getMine(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const targets = contributionTargets();
  return (
    <>
      <p className="small"><Link href="/contribute">← Your contributions</Link></p>
      <h1>{c.revisionState === "draft" ? "Edit draft" : "Your question"}</h1>
      {c.revisionState === "draft" ? (
        <ContributionEditor targets={targets} initial={{ id: c.id, draft: c.draft, revisionNumber: c.revisionNumber, hasLive: c.hasLive, requestedChanges: c.requestedChanges }} isMaintainer={isMaintainer(actor)} />
      ) : (
        <ContributionStatus c={{ id: c.id, state: c.state, revisionState: c.revisionState, revisionNumber: c.revisionNumber, requestedChanges: c.requestedChanges, draft: c.draft }} />
      )}
    </>
  );
}
