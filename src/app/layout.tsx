import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentActor } from "@/lib/session";
import { listMemberships } from "@/lib/services/access";
import { isAdmin } from "@/lib/types";
import { SITE_NOTICE } from "@/lib/copy";
import { config } from "@/lib/config";
import { SignOutButton } from "@/components/AuthForms";

export const metadata: Metadata = {
  title: { default: "OpenFrame: care packages, by students and neighbours", template: "%s · OpenFrame" },
  description: "An open-source, student-run network that collects what is needed for care packages for people experiencing homelessness, in London and Oshawa, Ontario.",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const memberships = actor ? listMemberships(actor.id) : [];
  const volunteers = memberships.length > 0;
  const coordinates = actor ? isAdmin(actor) || memberships.some((m) => m.role === "coordinator") : false;
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        {config.demo && (
          <div className="demo-banner" role="note">
            Demo mode: all chapters, needs and people are demonstration data.
          </div>
        )}
        <div className="site-notice" role="note" aria-label="About this site">
          <div className="wrap">{SITE_NOTICE}</div>
        </div>
        <header className="site">
          <div className="wrap">
            <Link href="/" className="brand">OpenFrame</Link>
            <nav className="main" aria-label="Main">
              <Link href="/">Needs</Link>
              <Link href="/impact">Impact</Link>
              {actor && <Link href="/pledges">My pledges</Link>}
              {volunteers && <Link href="/volunteer">My pickups</Link>}
              {coordinates && <Link href="/coordinate">Coordinate</Link>}
              {actor && isAdmin(actor) && <Link href="/admin">Admin</Link>}
            </nav>
            <div className="row small">
              {actor ? (
                <>
                  <Link href="/account">{actor.name || "Account"}</Link>
                  <SignOutButton />
                </>
              ) : (
                <Link className="btn small" href="/auth/sign-in">Sign in</Link>
              )}
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="wrap">{children}</div>
        </main>
        <footer className="site">
          <div className="wrap">
            <nav aria-label="Policies">
              <Link href="/about">About</Link>
              <Link href="/guidelines">Guidelines</Link>
              <Link href="/safety">Safety</Link>
              <Link href="/privacy">Privacy</Link>
            </nav>
            <p>
              OpenFrame is a free, open-source, student-run project (application code under the MIT license). No ads, no payments, no sale of data.
              It is not a registered charity and is not affiliated with any university.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
