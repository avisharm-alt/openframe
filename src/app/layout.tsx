import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Figtree, Fraunces } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { currentActor } from "@/lib/session";
import { config } from "@/lib/config";
import { isReviewer } from "@/lib/types";
import { SignOutButton } from "@/components/AuthForms";
import { SITE_NOTICE } from "@/lib/copy";
import { Avatar, BrandMark, NavLink, SiteMenu } from "@/components/ui";

// Self-hosted at build time by next/font (no runtime request to Google), so the CSP stays strict.
// Fraunces: a soft, warm variable serif for headings. Figtree: a friendly, very legible sans for everything else.
const display = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-fraunces", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata: Metadata = {
  title: { default: "OpenFrame – student-run practice questions", template: "%s · OpenFrame" },
  description: "A free, open-source, student-run question bank of student-contributed, AI-assisted practice questions.",
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6ee" },
    { media: "(prefers-color-scheme: dark)", color: "#181410" },
  ],
};
export const dynamic = "force-dynamic";

/**
 * Chapter switcher slot (e.g. London / Oshawa). Render a node here and it appears in the header between the
 * wordmark and the menu, collapsing sensibly on phones. `null` renders nothing.
 */
const chapterSwitcher: ReactNode = null;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const accountName = actor?.name || "Account";
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
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
          <div className="wrap site-bar">
            <Link href="/" className="brand">
              <BrandMark />
              <span>OpenFrame</span>
            </Link>
            {chapterSwitcher && <div className="chapter-slot">{chapterSwitcher}</div>}
            <SiteMenu>
              <nav className="main" aria-label="Main">
                <NavLink href="/">Courses</NavLink>
                <NavLink href="/saved">Saved &amp; history</NavLink>
                <NavLink href="/course-notes">Upload course notes</NavLink>
                {isReviewer(actor) && <NavLink href="/moderation">Moderation</NavLink>}
              </nav>
              <div className="site-account">
                {actor ? (
                  <>
                    <Link href="/account">
                      <Avatar name={accountName} size="sm" decorative />
                      {accountName}
                    </Link>
                    <SignOutButton />
                  </>
                ) : (
                  <Link className="btn small" href="/auth/sign-in">Sign in</Link>
                )}
              </div>
            </SiteMenu>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="wrap">{children}</div>
        </main>
        <footer className="site">
          <div className="wrap">
            <nav aria-label="Policies">
              <Link href="/about">About</Link>
              {/* /safety is created by the community-network restructure; prefetch is off so a missing route does not 404 in the console. Remove prefetch={false} once it exists. */}
              <Link href="/safety" prefetch={false}>Safety</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/guidelines">Guidelines</Link>
              <Link className="minor" href="/academic-integrity">Academic integrity</Link>
              <Link className="minor" href="/content-removal">Content removal</Link>
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
