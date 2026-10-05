# OpenFrame

An open-source, student-run **community care-package network**. Student teams in **London, ON (Western)** and **Oshawa, ON (Ontario Tech)** post what they need for care packages for people experiencing homelessness. Neighbours see the live needs, pledge items they have, and choose a **pickup from their address** or a **drop-off zone**. The team counts the items in, assembles packages and hands them out through partner agencies.

It is a continual operation, not a drive: needs, stock and packages are always live.

OpenFrame is independent and **not affiliated with or endorsed by any university**. It has no ads, payments or sale of data, and does not claim registered charitable status. **It never records the people who receive packages**: no names, descriptions or locations. A package records the partner agency and the date, nothing else.

> The previous student question-bank app is preserved in git history (tag `question-bank-final`).
>
> **Status: not launched.** Read "Before launch" below. Safety, insurance and partner wording is a proposal for the owner to confirm.

## What works

| Who | What | Where |
|---|---|---|
| Anyone | Chapter picker and live "What we need right now" board (needed / pledged / received), drop-off zones, impact counts | `/`, `/impact` |
| Donor (signed in) | Pledge items from open needs, with the accepted / not-accepted rules inline; pickup or drop-off; see, reschedule, cancel; report a volunteer concern | `/pledge`, `/pledges` |
| Volunteer | My pickups (address only inside the allowed window), Arrived / Done / Couldn't complete, open slots, Safety acknowledgement. Mobile first | `/volunteer`, `/safety` |
| Coordinator (per chapter) | Needs and template editors, drop-offs, pickup board (unassigned / scheduled / today / overdue), receive into inventory, inventory, assemble and hand off packages, volunteers, zones, partners, concern queue, audit log | `/coordinate/[chapter]` |
| Admin | Start chapters, appoint coordinators, read the audit log | `/admin` |

Roles: `member` (default), `volunteer`, `coordinator` (per chapter, stored in `chapter_member`) and `admin`. All roles are server-controlled: no client can set one, and a London coordinator cannot act on Oshawa.

### Pickups are safe by default

- **Address privacy.** Address, access notes and phone are encrypted at rest (AES-256-GCM, key from `PICKUP_ENCRYPTION_KEY`). They are shown only to the donor, the chapter's coordinators and the volunteers assigned to that pickup, from 24 hours before the window until the pickup is closed. Every view is written to the audit log. They are purged 7 days after the pledge is collected, cancelled or a no-show.
- **Two-person rule.** A pickup cannot become `scheduled` until a window is confirmed and two volunteers are assigned, and neither can check in unless both are.
- **Daytime windows.** 09:00 to 20:00 in the chapter's local time only.
- **Check-in and check-out.** Each volunteer taps Arrived, then Done or Couldn't complete with a reason. Coordinators get an overdue flag (and an email) if a pickup is not closed 2 hours after its window ends.
- **Safety rules.** Volunteers acknowledge the [Safety](src/app/safety/page.tsx) rules (timestamped) before their first assignment.
- **Concerns.** Donors can report a volunteer concern and volunteers a donor concern, into a coordinator queue.
- **Limits.** At most 3 open pickup pledges per donor, and pledge creation is rate limited.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**: one deployable Node process.
- **SQLite** via `better-sqlite3`: plain-SQL migrations in `migrations/`, one-file backups. Single instance on a persistent volume.
- **Better Auth**: Google OAuth sign-in, cookie sessions, pseudonymous display names, server-controlled `role` column.
- **Zod** validation (strict: unknown fields are rejected). **Vitest** tests. **Playwright + axe-core** browser/accessibility check.
- Business rules live in framework-free services in `src/lib/services/`; route handlers are thin.

No external service is required. Email goes through a pluggable provider interface; the default only logs a one-line summary. See [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Quick start (local demo)

Requires Node 20.9+ (developed on Node 22).

```bash
npm ci
cp .env.example .env.local        # set OPENFRAME_DEMO=1 for the demo
npm run db:seed-demo              # migrates, then seeds both chapters, demo accounts for every role, and a pickup in each state
npm run dev                       # http://localhost:3000
```

Demo accounts (password `demo-password-123`, created only by `db:seed-demo`, refused in production):

| Email | Role |
|---|---|
| demo-admin@example.test | admin |
| demo-london-coordinator@example.test, demo-oshawa-coordinator@example.test | coordinator |
| demo-london-volunteer-1/2/3@example.test, demo-oshawa-volunteer-1/2@example.test | volunteer |
| demo-new-volunteer@example.test | volunteer who has not acknowledged the Safety rules |
| demo-donor-1 to 6@example.test | donors with pledges in various states |
| demo-new-donor@example.test | donor with no pledges |

Demo flow: sign in as **demo-new-donor** and pledge → as the **London coordinator** open Pickups, assign two volunteers and confirm a window → as **volunteer 1** see "My pickups" (the address appears only inside the window) → check in and out → as the coordinator, count it on **Receive**, assemble a package, hand it off → see the **Impact** page.

### Environment variables

See `.env.example`. Key ones: `BASE_URL`, `AUTH_SECRET` and `PICKUP_ENCRYPTION_KEY` (both required in production, at least 32 characters, different from each other), `DATABASE_PATH`, `OPENFRAME_DEMO`, `TRUST_PROXY`, `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, `INITIAL_ADMIN_EMAILS`, `CONTACT_URL`, `SECURITY_CONTACT`, `PICKUP_PURGE_DAYS`, `PICKUP_VISIBLE_HOURS_BEFORE`, `PICKUP_OVERDUE_HOURS`, `EMAIL_PROVIDER`.

### Google sign-in

Production sign-in is **Google only**; email+password exists only in demo mode.

1. In the [Google Cloud Console](https://console.cloud.google.com/) create a project, then **APIs & Services → OAuth consent screen**: user type *External*, app name "OpenFrame", add your support email and a link to your privacy page. Keep only the default scopes (`openid`, `email`, `profile`).
2. **Credentials → Create credentials → OAuth client ID → Web application.** Add the redirect URI `https://YOUR-SITE/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local testing).
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. While the consent screen is in **Testing**, only listed test users can sign in. Publish it to open sign-in to everyone.

OpenFrame keeps your email and Google's account id, discards your real name and photo, and gives you a random display name (`neighbour-1234`).

## Operations

- **Daily:** `npm run admin:purge-pickups` (erases pickup details past the retention period).
- **Every 15 minutes:** `npm run admin:notify-overdue` (emails coordinators about overdue pickups).
- First admin: list your Google email in `INITIAL_ADMIN_EMAILS`, or `npm run admin:grant -- you@example.org admin`.
- Start a chapter: [docs/START-A-CHAPTER.md](docs/START-A-CHAPTER.md). Chapters are data, not code.

Details, cron examples, backups and the email interface: [docs/OPERATIONS.md](docs/OPERATIONS.md). Deploying on Railway: [docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md).

## Checks

```bash
npm run check                # eslint + tsc + vitest
npm run e2e                  # build, start a demo server and a production-style server, HTTP walkthrough + browser/axe check
SKIP_BROWSER=1 npm run e2e   # HTTP walkthrough only (what CI runs)
```

The walkthrough follows a donor's pickup pledge through coordinator assignment, the visibility window, collection, receiving into stock, package assembly, hand-off, the impact page and the purge, with negative checks for cross-chapter access and address leakage. The browser check drives the main flows by keyboard only at 1100px and 375px and runs axe-core (WCAG 2.0/2.1/2.2 A and AA tags) on every page it visits. Automated checks do not replace manual screen-reader testing.

## Layout

```
migrations/          plain SQL (001 auth, 002 old app, 003-005 old, 006 restructure, 007 care network, 008 seed catalog + chapters)
src/lib/services/    all business rules (access, chapters, items, templates, needs, inventory, packages, pledges, pickups, concerns, impact, audit, account): unit tested
src/lib/             config, db, auth, crypto (AES-GCM), email (provider interface), time (timezones, clock), guard / http / ratelimit
src/app/api/         thin route handlers (publicRoute / userRoute / adminRoute)
src/app, src/components   UI
scripts/             migrate, seed-demo, backup, grant-role, add-chapter, purge-pickups, notify-overdue, delete-user, e2e + browser checks
docs/                operations, safety operations, start a chapter, Railway deploy, implementation notes
tests/               vitest suites
```

## Before launch

1. Owner decisions on the Safety page wording, insurance and partner statements, the purge window, the visibility window and the email provider: see [docs/SAFETY-OPERATIONS.md](docs/SAFETY-OPERATIONS.md).
2. Set real `CONTACT_URL` and `SECURITY_CONTACT` addresses and update `SECURITY.md` and `CODE_OF_CONDUCT.md`.
3. Create the Google OAuth client and test a real sign-in (not exercised by the automated checks).
4. Recruit coordinators, add real zones and partners, review and activate each chapter's sample "Winter kit" template.
5. Set `PICKUP_ENCRYPTION_KEY`, schedule the two cron jobs, and rehearse a backup restore.

## Licensing

Application code: MIT (`LICENSE`). More: [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [SECURITY.md](SECURITY.md) · [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
