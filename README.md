# OpenFrame

A free, open-source, nonprofit-oriented, **student-run question bank**, launching at Western University (UWO). Students find original, student-contributed, AI-assisted multiple-choice practice questions organised by course and topic, with an explanation for every option and a transparent review process.

OpenFrame is independent and is **not affiliated with or endorsed by Western University** or any instructor. It has no subscriptions, ads, paid tiers, payments or sale of data, and does not claim registered charitable status. It never accepts actual university assessments (see [Academic integrity](src/app/academic-integrity/page.tsx) and `docs/MAINTAINERS.md`).

> **Status: MVP, not launched.** Production starts empty. Do not open real submissions until the owner confirms the content license and the real contact/review configuration (see "Launch requirements" below).

## What works

| Workflow | Where |
|---|---|
| Browse/search courses and topics, no account | `/` |
| Course page: topic counts, review-status filter, unofficial notice | `/courses/[slug]` |
| Practice setup (topics, 5/10/20 presets, difficulty, mode, optional timer) | `/practice/setup` |
| Practice mode (feedback + all-option explanations per answer) and self-test mode (nothing revealed until finish, scored server-side) | `/practice/[id]` |
| Results with totals, topic table (with sample sizes), retry-missed | `/practice/[id]` |
| Accounts, saved history, bookmarks (private) | `/saved`, `/account` |
| Guided contribution editor with learner preview, drafts, revisions | `/contribute` |
| Reports (anyone, rate limited) and content-removal route | question "Report a problem", `/content-removal` |
| Moderation: queue, checklist review, reports, course requests, audit log, withdrawal | `/moderation` |
| Policies: About, Guidelines, Academic integrity, Privacy, Content removal | footer links |

## Stack (and why)

- **Next.js 16** (App Router) + **React 19** + **TypeScript** — mainstream, one deployable Node process.
- **SQLite** via `better-sqlite3` — real relational persistence, plain-SQL migrations in `migrations/`, zero-ops backups (a single file), cheap for volunteer maintainers. The schema is multi-university; only Western is enabled in the UI.
- **Better Auth** — maintained email+password auth with cookie sessions and built-in rate limiting. The `role` column is server-controlled and cannot be set by clients.
- **Zod** for server-side validation; **react-markdown + KaTeX** for safe Markdown/maths (raw HTML, images and iframes disabled).
- **Design system** in `src/app/globals.css` (tokens for light and dark, navy/indigo palette, Inter throughout). The font is self-hosted through `@fontsource-variable/inter`, so there are no third-party requests and the CSP stays `'self'`.
- **Vitest** for tests; **Playwright (Chromium) + axe-core** for the browser/accessibility check.
- Dependencies are pinned to exact versions in `package.json`.

No external service or API key is required. No AI API is used or required: contributors generate questions with their own tools and submit structured text.

## Quick start (local demo)

Requires Node 20.9+ (developed on Node 22).

```bash
npm ci
cp .env.example .env.local        # then edit it: set OPENFRAME_DEMO=1 for the demo
npm run db:seed-demo              # migrates, adds 3 demo courses, 24 UNREVIEWED demo questions, demo accounts, a pending submission
npm run dev                       # http://localhost:3000
```

The `db:*` and `admin:*` scripts read `.env.local` automatically (Node's `--env-file-if-exists`), as does `next dev`.

Demo accounts (created only by `db:seed-demo`, refused in production): password `demo-password-123`

| Email | Role |
|---|---|
| demo-student@example.test | student |
| demo-reviewer@example.test | reviewer |
| demo-maintainer@example.test | maintainer |

Demo flow: sign in as the **student**, write a question and submit it → sign in as the **reviewer**, open `/moderation`, review and approve it (authors can never review their own submissions) → practise it as a guest → report it → withdraw it from the moderation reports tab.

All seeded questions are labelled **Demo** and **Unreviewed**. By default, practice uses only *student-reviewed* questions, so tick **Include unreviewed questions** on the setup page (or use "Include unreviewed" on a course page) to practise the demo set.

### Environment variables

See `.env.example`. Key ones: `BASE_URL`, `AUTH_SECRET` (required in production, ≥32 chars), `DATABASE_PATH`, `OPENFRAME_DEMO`, `TRUST_PROXY` (set to 1 behind a reverse proxy so rate limits see client IPs), `CONTENT_REMOVAL_CONTACT`, `SECURITY_CONTACT`, `ALLOWED_EMAIL_DOMAINS` (e.g. `uwo.ca`), `SMTP_URL` + `EMAIL_FROM`.

### Accounts: @uwo.ca only, with verified email

Set `ALLOWED_EMAIL_DOMAINS=uwo.ca`. Then sign-up accepts only addresses on exactly that domain (look-alikes such as `uwo.ca.evil.com` and `+alias` addresses are refused), and **every account must verify its email** through a link before it can sign in, because a domain check alone proves nothing. Password reset uses the same email channel. You need an SMTP account for this (`SMTP_URL`); production refuses to start without one. Notes: `@uwo.ca` addresses are issued to staff and faculty as well as students, so the domain cannot tell them apart; and a maintainer without a `@uwo.ca` address must temporarily add their own domain to the list to create their account, then run `npm run admin:grant`. Guests can still browse and practise without any account.

In demo mode (`OPENFRAME_DEMO=1`, no `SMTP_URL`) emails are not sent: they are logged and appended to `data/outbox.jsonl` so you can open the links locally.

### Production

```bash
npm ci && npm run build
AUTH_SECRET=... BASE_URL=https://your.site DATABASE_PATH=/var/lib/openframe/openframe.db TRUST_PROXY=1 npm start
```

Migrations are applied automatically the first time the database is opened (and by `npm run db:migrate`). Production starts **empty**; there is no seed. Put the app behind HTTPS (cookies are `Secure` in production). See `docs/MAINTAINERS.md` for roles, reviews, removals, backups and restoration.

## Checks

```bash
npm run check          # eslint + tsc + vitest (27 tests)
npm run e2e            # build, start on a throwaway DB, HTTP walkthrough (52 checks) + browser/axe check
SKIP_BROWSER=1 npm run e2e   # HTTP walkthrough only (what CI runs)
```

The walkthrough covers contribution → independent review → publication → practice → report → withdrawal, plus uploads, cross-origin writes, role escalation and cross-user access. The browser check drives a guest through practice **by keyboard only** at desktop and 375px widths and runs axe-core (WCAG 2.0/2.1/2.2 A/AA rules) over the main pages. Automated checks do not replace manual screen-reader testing.

## Database and hosting

No separate database server (and no MongoDB) is needed: data lives in one SQLite file at `DATABASE_PATH`. Run it on a host with a **persistent disk** (a small VPS, or Fly.io / Railway / Render with an attached volume), single instance, and back up that file (`npm run db:backup`). Serverless platforms with an ephemeral filesystem (for example Vercel) will lose data and are not suitable as-is. If you later outgrow one instance, the service layer in `src/lib/services/` is the only place that talks to SQL and could be pointed at Postgres.

## Layout

```
migrations/            plain SQL (001 = Better Auth schema, regenerate with npm run db:gen-auth-sql; 002 = app schema)
src/lib/services/      all business rules (catalog, practice, contributions, moderation, reports, account) — framework-free, unit tested
src/lib/http.ts        route wrapper: request guard, auth level, JSON parsing, error mapping
src/lib/guard.ts       rejects uploads / non-JSON bodies / oversized / cross-origin writes (also run from src/proxy.ts)
src/app/api/           thin route handlers
src/app, src/components  UI
scripts/               migrate, seed-demo, backup, grant-role, delete-user, purge-guest-sessions, e2e + browser checks
docs/                  implementation plan/notes, maintainer guide, content-license proposal
tests/                 vitest suites
```

## Licensing

Application code: MIT (`LICENSE`). Accepted question **content** is covered by a separate content license that is **proposed but unconfirmed**: see `docs/CONTENT-LICENSE.md`.

More: [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [SECURITY.md](SECURITY.md) · [docs/MAINTAINERS.md](docs/MAINTAINERS.md) · [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
