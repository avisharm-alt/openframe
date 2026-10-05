import Link from "next/link";
import { listChapters } from "@/lib/services/chapters";
import { listBoard } from "@/lib/services/needs";
import { listZones } from "@/lib/services/zones";
import { listPartners } from "@/lib/services/partners";
import { NeedsBoard } from "@/components/NeedsBoard";
import { ACCEPTED, NEW_ONLY_NOTE, NOT_ACCEPTED } from "@/lib/copy";

export default async function Home({ searchParams }: { searchParams: Promise<{ chapter?: string }> }) {
  const chapters = listChapters();
  const slug = (await searchParams).chapter;
  const selected = chapters.find((c) => c.slug === slug) ?? chapters[0];
  const board = selected ? listBoard(selected.id) : [];
  const zones = selected ? listZones(selected.id, { activeOnly: true }) : [];
  const partners = selected ? listPartners(selected.id, { activeOnly: true }) : [];
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Student-run · London and Oshawa, Ontario</p>
        <h1>Care packages, built from what our neighbours have</h1>
        <p className="muted">
          Student teams collect the items for care packages for people experiencing homelessness and hand them out through partner agencies. This is what each team needs right now. Pledge what you
          have, then choose a pickup from your door or a drop-off at a public location.
        </p>
      </section>

      {!selected ? (
        <p className="notice warn" role="status">No chapters are set up yet.</p>
      ) : (
        <>
          <nav aria-label="Chapters" className="chapter-picker">
            {chapters.map((c) => (
              <Link key={c.slug} href={`/?chapter=${c.slug}`} className="chapter-panel" aria-current={c.slug === selected.slug ? "page" : undefined}>
                <span className="name">{c.name}</span>
                <span className="meta">{c.city}</span>
              </Link>
            ))}
          </nav>

          <section className="section" aria-labelledby="needs-h">
            <div className="section-heading">
              <h2 id="needs-h">What we need right now in {selected.city.replace(/,.*$/, "")}</h2>
              <p className="muted" role="status">{board.length} open need{board.length === 1 ? "" : "s"}</p>
            </div>
            <p><Link className="btn" href={`/pledge?chapter=${selected.slug}`}>Pledge items</Link></p>
            <NeedsBoard lines={board} />
          </section>

          <div className="cols section">
            <section aria-labelledby="accept-h" className="rules">
              <h2 id="accept-h" style={{ marginTop: 0 }}>What we accept</h2>
              <ul>{ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul>
              <p className="small muted">{NEW_ONLY_NOTE}</p>
            </section>
            <section aria-labelledby="notaccept-h" className="rules">
              <h2 id="notaccept-h" style={{ marginTop: 0 }}>What we can’t accept</h2>
              <ul>{NOT_ACCEPTED.map((a) => <li key={a}>{a}</li>)}</ul>
            </section>
          </div>

          <section className="section" aria-labelledby="zones-h">
            <h2 id="zones-h" style={{ marginTop: 0 }}>Drop-off zones in {selected.city.replace(/,.*$/, "")}</h2>
            {zones.length === 0 ? (
              <p className="empty">No drop-off zones yet. You can still choose a pickup.</p>
            ) : (
              <ul>
                {zones.map((z) => (
                  <li key={z.id}><b>{z.name}</b>: {z.description}{z.hours && <> <span className="muted">({z.hours})</span></>}</li>
                ))}
              </ul>
            )}
            {partners.length > 0 && (
              <>
                <h3>Partner agencies</h3>
                <ul>{partners.map((p) => <li key={p.id}><b>{p.name}</b>{p.description && <>: {p.description}</>}</li>)}</ul>
              </>
            )}
          </section>
        </>
      )}
      <p className="small muted">See the <Link href="/impact">impact so far</Link>, how it works on the <Link href="/about">About page</Link>, and the <Link href="/safety">Safety page</Link>.</p>
    </>
  );
}
