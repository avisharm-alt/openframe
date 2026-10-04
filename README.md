# OpenFrame

A free, open-source, nonprofit-oriented, **student-run question bank**, with university directories for Western University and the University of Toronto. Students find original, student-contributed, AI-assisted multiple-choice practice questions organised by course and topic, with an explanation for every option and a transparent review process: a question is only labelled **Verified** after two independent student reviewers have checked it.

OpenFrame is independent and is **not affiliated with or endorsed by any university** or instructor. It has no subscriptions, ads, paid tiers, payments or sale of data, and does not claim registered charitable status. It never accepts actual university assessments (see [Academic integrity](src/app/academic-integrity/page.tsx) and `docs/MAINTAINERS.md`).

> **Status: MVP, not launched.** Production automatically imports the 300 owner-supplied Western lecture questions; U of T starts empty. Do not open real submissions until the owner confirms the content license and the real contact/review configuration (see "Launch requirements" below).

## What works

| Workflow | Where |
|---|---|
| Browse universities, then their courses; search courses and topics, no account | `/`, `/universities/[slug]` |
| Course page: verified vs total question counts and unofficial notice | `/courses/[slug]` |
| Practice setup (topics, 5/10/20 presets, difficulty, mode, optional timer; **verified questions only by default**, with an opt-in "Include unverified questions") | `/practice/setup` |
| Practice mode (feedback + all-option explanations per answer) and self-test mode (nothing revealed until finish, scored server-side) | `/practice/[id]` |
| Results with totals, topic table (with sample sizes), retry-missed | `/practice/[id]` |
| Accounts, saved history, bookmarks (private) | `/saved`, `/account` |
| Guided contribution editor with learner preview, drafts, revisions | `/contribute/new` |
| Private course-notes upload (**off by default**, `OPENFRAME_NOTES_UPLOADS=1`) | `/course-notes` |
| Reports (anyone, rate limited) and content-removal route | question "Report a problem", `/content-removal` |
| Moderation: submissions queue, **needs-verification queue with keyboard shortcuts and reviewer edits**, **weak-item statistics**, checklist review, reports, course requests, audit log, withdrawal | `/moderation` |
| Policies: About, Guidelines, Academic integrity, Privacy, Content removal | footer links |

## Stack (and why)

- **Next.js 16** (App Router) + **React 19** + **TypeScript** — mainstream, one deployable Node process.
- **SQLite** via `better-sqlite3` — real relational persistence, plain-SQL migrations in `migrations/`, zero-ops backups (a single file), cheap for volunteer maintainers. The schema supports multiple universities; Western and U of T are enabled, with U of T starting empty.
- **Better Auth** — maintained auth library: **Google OAuth** sign-in, cookie sessions, built-in rate limiting. No passwords are stored in production. The `role` column is server-controlled and cannot be set by clients.
- **Zod** for server-side validation; **react-markdown + KaTeX** for safe Markdown/maths (raw HTML, images and iframes disabled).
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

Demo flow: sign in as the **student**, write a question and submit it → sign in as the **reviewer** and the **maintainer** and have both approve it in `/moderation` (a question is published and **Verified** only after two different reviewers approve; authors can never review their own submissions) → practise it as a guest → report it → withdraw it from the moderation reports tab.

All seeded questions are labelled **Demo** and start **Unverified**. To practise them, tick **Include unverified questions** on the setup page (or use "Include unverified" on a course page); to see a Verified badge, verify one from `/moderation?tab=verify` with the reviewer and the maintainer accounts.

### Verification

- A revision is **Verified** (`question_revision.review_status = 'student_reviewed'`) only after approvals from two different reviewers, neither of whom wrote or edited the question. Approvals live in `review`; each approving reviewer gets a `verified` event in `moderation_event`. A database trigger (migration 006) refuses the mark otherwise, so the importer's owner-review statement can never count.
- The 300 AI-generated Western questions are published **Unverified** and wait in the `/moderation?tab=verify` queue.
- Learners see "✓ Verified by A and B on DATE" or "Unverified (AI-generated)" on every question, verified vs total counts on course pages, and practise verified questions by default.
- `/moderation?tab=weak` lists per-question attempts, % correct and option picks (aggregates only), flagging questions with 30+ attempts that are over 95% or under 25% correct, or where a wrong option beats the key.

### Environment variables

See `.env.example`. Key ones: `BASE_URL`, `AUTH_SECRET` (required in production, ≥32 chars), `DATABASE_PATH`, `OPENFRAME_DEMO`, `TRUST_PROXY` (set to 1 behind a reverse proxy so rate limits see client IPs), `CONTENT_REMOVAL_CONTACT`, `SECURITY_CONTACT`, `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, `INITIAL_MAINTAINER_EMAILS`, `OPENFRAME_NOTES_UPLOADS` (course-notes uploads; **off by default**, 404 everywhere while off).

### Google sign-in

Production sign-in is **Google only**: there are no passwords to store, reset or email. Anyone with a Google account can sign in; guests can still browse and practise without one.

One-time setup (about 10 minutes, free):
1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project, then **APIs & Services → OAuth consent screen**: user type *External*, app name "OpenFrame", add your support email and a link to your privacy page. Under scopes keep only the defaults (`openid`, `email`, `profile`). Do **not** add sensitive scopes.
2. **Credentials → Create credentials → OAuth client ID → Web application.** Under *Authorized redirect URIs* add exactly `https://YOUR-SITE/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local testing).
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (keep the secret out of git).
4. While the consent screen is in **Testing**, only test users you list can sign in. Click **Publish app** to open it to everyone. With only basic scopes Google normally doesn't require a verification review, but check Google's current rules for your project.

What OpenFrame keeps from Google: your email address and Google's account id. It deliberately discards your real name and photo, gives you a random display name (`student-1234`) that you can change on `/account`, and stores Google's tokens encrypted. Because anyone with a Google account can register, each person may have at most 10 submissions waiting in the review queue, and publication always needs a human reviewer.

In **demo mode** only (`OPENFRAME_DEMO=1`), email+password sign-in also exists so the seeded demo accounts and automated tests work without Google. It is disabled outside demo mode.

## Checks

```bash
npm run check          # eslint + tsc + vitest
npm run e2e            # build, start on a throwaway DB, HTTP walkthrough (72 checks on a demo server, 19 on a production-style server) + browser/axe check
SKIP_BROWSER=1 npm run e2e   # HTTP walkthrough only (what CI runs)
```

The walkthrough covers contribution → two-reviewer verification → verified badge data and counts → verified-only practice default → reviewer edit → report → withdrawal, plus item statistics, the notes feature flag, uploads, cross-origin writes, role escalation and cross-user access. The browser check drives two-reviewer verification through the review workspace with keyboard shortcuts, checks the Verified badge and the verified-only practice default, and drives a guest through practice **by keyboard only** at desktop and 375px widths and runs axe-core (WCAG 2.0/2.1/2.2 A/AA rules) over the main pages. Automated checks do not replace manual screen-reader testing.

## Deploying

Step-by-step Railway guide: [docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md) (one service, one persistent volume, one replica; health check at `/api/health`; first maintainer via `INITIAL_MAINTAINER_EMAILS`).

## Database and hosting

No separate database server (and no MongoDB) is needed: data lives in one SQLite file at `DATABASE_PATH`. Run it on a host with a **persistent disk** (a small VPS, or Fly.io / Railway / Render with an attached volume), single instance, and back up that file (`npm run db:backup`). Serverless platforms with an ephemeral filesystem (for example Vercel) will lose data and are not suitable as-is. If you later outgrow one instance, the service layer in `src/lib/services/` is the only place that talks to SQL and could be pointed at Postgres.

## Layout

```
migrations/            plain SQL (001 = Better Auth schema, regenerate with npm run db:gen-auth-sql; 002 = app schema; 003 = universities; 004 = question-bank imports; 005 = course notes; 006 = two-reviewer verification; 007 = course-note attestation)
src/lib/services/      all business rules (catalog, practice, contributions, moderation, verification, item-analysis, reports, account) — framework-free, unit tested
src/lib/http.ts        route wrapper: request guard, auth level, JSON parsing, error mapping
src/lib/guard.ts       rejects uploads / non-JSON bodies / oversized / cross-origin writes (also run from src/proxy.ts)
src/app/api/           thin route handlers
src/app, src/components  UI
content/western/       150 biochemistry + 150 organic chemistry questions, without private source evidence
scripts/               migrate, import-questions, seed-demo, backup, grant-role, delete-user, purge-guest-sessions, e2e + browser checks
docs/                  implementation plan/notes, maintainer guide, content-license proposal
tests/                 vitest suites
```

## Licensing

Application code: MIT (`LICENSE`). Accepted question **content** is proposed to be released under **CC BY 4.0**, which is **unconfirmed** and needs the owner's decision (the bundled AI-generated Western banks are excluded for now): see `docs/CONTENT-LICENSE.md`.

More: [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [SECURITY.md](SECURITY.md) · [docs/MAINTAINERS.md](docs/MAINTAINERS.md) · [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
