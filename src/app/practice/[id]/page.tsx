import { currentActor } from "@/lib/session";
import { bookmarkedIds } from "@/lib/services/bookmarks";
import { SessionPlayer } from "@/components/SessionPlayer";

export const metadata = { title: "Practice session" };

export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  return <SessionPlayer sessionId={id} signedIn={!!actor} bookmarked={[...bookmarkedIds(actor)]} />;
}
