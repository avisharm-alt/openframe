import Link from "next/link";
import { listChapters } from "@/lib/services/chapters";
import { listBoard } from "@/lib/services/requests";
import { listZones } from "@/lib/services/zones";
import { listPartners } from "@/lib/services/partners";
import { RequestCard } from "@/components/RequestCard";
import { ACCEPTED, NEW_ONLY_NOTE, NOT_ACCEPTED } from "@/lib/copy";
import { CATEGORY_LABELS, ITEM_CATEGORIES, SIZES } from "@/lib/types";

const ALL_SIZES = [...new Set([...SIZES.letter, ...SIZES.shoe, ...SIZES.numeric])];

export default async function Home({ searchParams }: { searchParams: Promise<{ chapter?: string; category?: string; size?: string }> }) {
  const chapters = listChapters();
  const sp = await searchParams;
  const selected = chapters.find((c) => c.slug === sp.chapter) ?? chapters[0];
  const category = [...ITEM_CATEGORIES, "kit"].includes(sp.category ?? "") ? sp.category : undefined;
  const size = ALL_SIZES.includes((sp.size ?? "").toUpperCase()) ? sp.size!.toUpperCase() : undefined;
  const board = selected ? listBoard(selected.id, { category, size }) : [];
  const zones = selected ? listZones(selected.id, { activeOnly: true }) : [];
  const partners = selected ? listPartners(selected.id) : [];
  const city = selected?.city.replace(/,.*$/, "");
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Student-run · London and Oshawa, Ontario</p>
        <h1>Specific things, from neighbours, to people who need them</h1>
        <p className="muted">
          Frontline workers at shelters, outreach teams and drop-ins post exactly what someone needs. You claim a request, hand the item to us by pickup or drop-off, and student volunteers deliver it to the agency, usually within three days.
          Agency staff hand it to the person. We never meet, record or ask about the people who receive items.
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

          <section className="section" aria-labelledby="board-h">
            <div className="section-heading">
              <h2 id="board-h">Requests in {city}</h2>
              <p className="muted" role="status">{board.length} open request{board.length === 1 ? "" : "s"}</p>
            </div>
            <form className="inline filters" action="/" method="get" aria-label="Filter requests">
              <input type="hidden" name="chapter" value={selected.slug} />
              <div>
                <label htmlFor="f-category">Category</label>
                <select id="f-category" name="category" defaultValue={category ?? ""}>
                  <option value="">All categories</option>
                  {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  <option value="kit">Ready-made kits</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-size">Size</label>
                <select id="f-size" name="size" defaultValue={size ?? ""}>
                  <option value="">Any size</option>
                  {ALL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <button className="btn secondary">Filter</button>
              {(category || size) && <Link href={`/?chapter=${selected.slug}`} className="small">Clear filters</Link>}
            </form>
            <p className="small muted">Most urgent first, then soonest needed-by. Requests with a striped edge are the student team’s own restock requests.</p>
            {board.length === 0 ? (
              <p className="notice" role="status">{category || size ? "No open requests match those filters." : "Nothing is requested right now. Thank you! Check back soon, or see the impact page."}</p>
            ) : (
              <ul className="need-list">
                {board.map((c) => <RequestCard key={c.requestId} c={c} claimHref={`/claim/${c.requestId}`} />)}
              </ul>
            )}
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
            <h2 id="zones-h" style={{ marginTop: 0 }}>Drop-off zones in {city}</h2>
            {zones.length === 0 ? (
              <p className="empty">No drop-off zones yet. You can still choose a pickup.</p>
            ) : (
              <ul>{zones.map((z) => <li key={z.id}><b>{z.name}</b>: {z.description}{z.hours && <> <span className="muted">({z.hours})</span></>}</li>)}</ul>
            )}
            {partners.length > 0 && (
              <>
                <h3>Partners we deliver to</h3>
                <ul>{partners.map((p) => <li key={p.id}><b>{p.name}</b>{p.description && <>: {p.description}</>}</li>)}</ul>
              </>
            )}
            <p className="small muted">Work at an agency? <Link href="/partner">Post requests for your partner</Link>.</p>
          </section>
        </>
      )}
      <p className="small muted">See the <Link href="/impact">impact so far</Link>, how it works on the <Link href="/about">About page</Link>, and the <Link href="/safety">Safety page</Link>.</p>
    </>
  );
}
