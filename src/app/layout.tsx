import type { Metadata } from "next";
import Link from "next/link";
import "katex/dist/katex.min.css";
import "./globals.css";
import { currentActor } from "@/lib/session";
import { config } from "@/lib/config";
import { isReviewer } from "@/lib/types";
import { SignOutButton } from "@/components/AuthForms";
import { SITE_NOTICE } from "@/lib/copy";

export const metadata: Metadata = {
  title: { default: "OpenFrame – student-run practice questions", template: "%s · OpenFrame" },
  description: "A free, open-source, student-run question bank of student-contributed, AI-assisted practice questions.",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        {config.demo && (
          <div className="demo-banner" role="note">
            Demo mode: all courses and questions are demonstration content.
          </div>
        )}
        <div className="site-notice" role="note" aria-label="About this site">
          <div className="wrap">{SITE_NOTICE}</div>
        </div>
        <header className="site">
          <div className="wrap">
            <Link href="/" className="brand">OpenFrame</Link>
            <nav className="main" aria-label="Main">
              <Link href="/">Courses</Link>
              <Link href="/saved">Saved &amp; history</Link>
              <Link href="/contribute">Contribute</Link>
              {isReviewer(actor) && <Link href="/moderation">Moderation</Link>}
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
              <Link href="/guidelines">Contribution guidelines</Link>
              <Link href="/academic-integrity">Academic integrity</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/content-removal">Content removal</Link>
            </nav>
            <p>
              OpenFrame is a free, open-source, nonprofit-oriented student project (application code under the MIT license). No ads, no subscriptions, no sale of data.
              It is not a registered charity. Practice scores are not predictions of exam results.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
