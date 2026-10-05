# OpenFrame

An open-source, **student-run link between community partners and neighbours**, serving people experiencing homelessness in **London, ON (Western)** and **Oshawa, ON (Ontario Tech)**.

1. **Partners** (verified frontline workers at shelters, outreach teams, drop-ins) post **specific, anonymous requests**: "Men's winter boots, size 11, by Friday, deliver to Ark Aid Street Mission". It takes under 30 seconds on a phone.
2. **Neighbours** claim a request (all of it, or part) and hand the item over by **pickup from their address** or a **public drop-off zone**.
3. **Student teams** verify partners, run pickups and drop-offs in pairs on weekly shifts, keep a small **fast stock** of common essentials so many requests are filled the same day, and **deliver to the agency**. Agency staff hand the item to the person. Students never deal with recipients.

The number we care about is **the time from request to delivery** (target: under 72 hours). It leads the public [Impact](src/app/impact/page.tsx) page.

OpenFrame is independent and **not affiliated with or endorsed by any university**. It has no ads, payments or sale of data, and does not claim registered charitable status. **It never records the people who receive items**: no names, descriptions or locations. A request records the partner, the delivery site, the item and the dates, nothing else.

> The previous student question-bank app is preserved in git history (tag `question-bank-final`).
>
> **Status: not launched.** Read "Before launch" below. The name "OpenFrame" conflicts with existing marks and products; see [docs/NAME.md](docs/NAME.md). Safety, insurance, partner and partnership-note wording is a proposal for the owner to confirm.

## What works

| Who | What | Where |
|---|---|---|
| Anyone | Chapter picker and the live request board (item, size, quantity, partner, needed-by, urgency badge; filter by category and size; restock requests look different), drop-off zones, impact | `/`, `/impact` |
| Neighbour (signed in) | Claim a request with the accepted / not-accepted rules and the partner's exclusions inline; pickup or drop-off; **My claims** with status, reschedule, cancel, concern reports and "Delivered to [partner] on [date]"; unscheduled pickup claims are released after 48 hours | `/claim/[id]`, `/claims` |
| Agency worker | Ask for access to a partner (a coordinator approves). Post a request in under 30 seconds, repeat the last one, save favourites, see the partner's own requests, confirm receipt. Mobile first. Workers see only their own partner | `/partner` |
| Volunteer | My shifts (weekly slots), my pickups (address only inside the allowed window; Arrived / Done / Couldn't complete), open pickups, my delivery run with the site's receiving hours, Safety acknowledgement. Mobile first | `/volunteer`, `/safety` |
| Coordinator (per chapter) | Requests triage (at-risk highlighting, **Fill from stock**), pickup board, drop-offs, receive, deliveries by site, fast stock with restock targets, kit templates and assembly, approvals for partners and workers, partners and sites, volunteers, shifts and coverage gaps, zones, concern queue, audit log | `/coordinate/[chapter]` |
| Admin | Start chapters, appoint coordinators, read the audit log | `/admin` |

Roles: `member` (default) and `admin` on the user; `volunteer` and `coordinator` per chapter (`chapter_member`); `agency_worker` per partner (`partner_member`). All are server-controlled: no client can set one, a London coordinator cannot act on Oshawa, and a worker sees only their own partner.

### Requests and claims

- **Request:** `open → claimed → in_transit → delivered → confirmed`, or `expired` / `cancelled`. `claimed` means fully committed; partial claims leave the rest on the board. `in_transit` means the items are in hand (counted in, or filled from stock). An agency worker (or a coordinator on their behalf) confirms receipt.
- **Claim:** pickup `claimed → scheduled → collected → received` (or `cancelled` / `no_show`), drop-off `scheduled → received`. A pickup claim nobody schedules within 48 hours is released and the request returns to the board.
- **Fast stock:** an append-only ledger per chapter, item and size (`received`, `allocated_to_request`, `assembled_into_kit`, `adjusted`, `discarded`) that can never go below zero. **Fill from stock** moves a request straight to `in_transit`. Items from a claim that arrives after its request was filled go to stock.
- **Restock:** when stock is below a coordinator's target, one restock request is posted to the board automatically (and withdrawn when stock recovers).
- **Kits:** a template names the contents of a ready-made bag; workers can request N kits, and assembly is atomic.

### Pickups are safe by default

- **Address privacy.** Address, access notes and phone are encrypted at rest (AES-256-GCM, key from `PICKUP_ENCRYPTION_KEY`). They are shown only to the claiming neighbour, the chapter's coordinators and the volunteers assigned to that pickup, from 24 hours before the window until the pickup is closed. Every view is written to the audit log. They are purged 7 days after the claim is collected, cancelled or a no-show.
- **Two-person rule.** A pickup cannot become `scheduled` until a window is confirmed and two volunteers are assigned, and neither can check in unless both are.
- **Daytime windows.** 09:00 to 20:00 in the chapter's local time only.
- **Check-in and check-out.** Each volunteer taps Arrived, then Done or Couldn't complete with a reason. Coordinators get an overdue flag (and an email) if a pickup is not closed 2 hours after its window ends.
- **Safety rules.** Volunteers acknowledge the [Safety](src/app/safety/page.tsx) rules (timestamped) before their first assignment, including the rule that students never deal with recipients.
- **Concerns.** Neighbours can report a volunteer concern and volunteers a neighbour concern, into a coordinator queue.
- **Limits.** At most 3 open pickup claims per neighbour; claims and requests are rate limited.

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
npm run db:seed-demo              # migrates, then seeds both chapters, partners with delivery sites, demo accounts for every role, requests and claims in every state
npm run dev                       # http://localhost:3000
```

Demo accounts (password `demo-password-123`, created only by `db:seed-demo`, refused in production):

| Email | Role |
|---|---|
| demo-admin@example.test | admin |
| demo-london-coordinator@example.test, demo-oshawa-coordinator@example.test | coordinator |
| demo-london-volunteer-1/2/3@example.test, demo-oshawa-volunteer-1/2@example.test | volunteer |
| demo-new-volunteer@example.test | volunteer who has not acknowledged the Safety rules |
| demo-london-worker@example.test, demo-downtown-worker@example.test, demo-oshawa-worker@example.test | approved agency workers |
| demo-pending-worker@example.test | worker waiting for approval |
| demo-partner-applicant@example.test | applied for a new partner, waiting for verification |
| demo-neighbour-1 to 6@example.test | neighbours with claims in various states |
| demo-new-neighbour@example.test | neighbour with no claims |

Demo flow: sign in as **demo-london-worker** and post a request (or repeat the last one) → as **demo-new-neighbour** claim it with a pickup → as the **London coordinator** open Pickups, assign two volunteers and confirm a window → as **volunteer 1** see the address appear only inside the window and check in and out → as the coordinator, count it on **Receive**, plan a delivery on **Deliveries** → as the volunteer, start and complete the run → as the worker, **confirm receipt** → as the neighbour see "Delivered to…" → see the **Impact** page. For the same-day path, use **Fill from stock** on an open request.

### Environment variables

See `.env.example`. Key ones: `BASE_URL`, `AUTH_SECRET` and `PICKUP_ENCRYPTION_KEY` (both required in production, at least 32 characters, different from each other), `DATABASE_PATH`, `OPENFRAME_DEMO`, `TRUST_PROXY`, `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, `INITIAL_ADMIN_EMAILS`, `CONTACT_URL`, `SECURITY_CONTACT`, `PICKUP_PURGE_DAYS`, `PICKUP_VISIBLE_HOURS_BEFORE`, `PICKUP_OVERDUE_HOURS`, `CLAIM_RELEASE_HOURS`, `REQUEST_RISK_DAYS`, `EMAIL_PROVIDER`.

### Google sign-in

Production sign-in is **Google only**; email+password exists only in demo mode.

1. In the [Google Cloud Console](https://console.cloud.google.com/) create a project, then **APIs & Services → OAuth consent screen**: user type *External*, app name "OpenFrame", add your support email and a link to your privacy page. Keep only the default scopes (`openid`, `email`, `profile`).
2. **Credentials → Create credentials → OAuth client ID → Web application.** Add the redirect URI `https://YOUR-SITE/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local testing).
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. While the consent screen is in **Testing**, only listed test users can sign in. Publish it to open sign-in to everyone.

OpenFrame keeps your email and Google's account id, discards your real name and photo, and gives you a random display name (`neighbour-1234`).

## Operations

- **Daily:** `npm run admin:purge-pickups` (erases pickup details past the retention period).
- **Every 15 minutes:** `npm run admin:sweep` (releases unscheduled claims after 48 hours, expires stale requests, posts restock requests, emails coordinators about at-risk requests and overdue pickups, sends shift reminders).
- First admin: list your Google email in `INITIAL_ADMIN_EMAILS`, or `npm run admin:grant -- you@example.org admin`.
- Start a chapter: [docs/START-A-CHAPTER.md](docs/START-A-CHAPTER.md). Onboard a partner: [docs/PARTNER-ONBOARDING.md](docs/PARTNER-ONBOARDING.md). Chapters and partners are data, not code.

Details, cron examples, backups and the email interface: [docs/OPERATIONS.md](docs/OPERATIONS.md). Deploying on Railway: [docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md).

## Checks

```bash
npm run check                # eslint + tsc + vitest
npm run e2e                  # build, start a demo server and a production-style server, HTTP walkthrough + browser/axe check
SKIP_BROWSER=1 npm run e2e   # HTTP walkthrough only (what CI runs)
```

The walkthrough follows a request from an agency worker's post, through a neighbour's pickup claim, coordinator assignment of two volunteers, the visibility window, collection, receiving, delivery to the agency, the worker's confirmation, the neighbour's "Delivered to…" and the impact page, to the purge. It also fills a second request straight from stock, checks claim auto-release and restock requests, and runs negative checks for cross-chapter and cross-partner access and address leakage. The browser check drives the main flows by keyboard only at 1100px and 375px and runs axe-core (WCAG 2.0/2.1/2.2 A and AA tags) on every page it visits. Automated checks do not replace manual screen-reader testing.

## Layout

```
migrations/          plain SQL (001 auth, 002-005 old app, 006 restructure, 007-008 care network, 009 partners/requests/claims, 010 seed catalog + kit)
src/lib/services/    all business rules (access, chapters, partners, items, requests, claims, stock, restock, kits, deliveries, shifts, pickups, concerns, impact, sweep, notifications, audit, account): unit tested
src/lib/             config, db, auth, crypto (AES-GCM), email (provider interface), time (timezones, clock), guard / http / ratelimit
src/app/api/         thin route handlers (publicRoute / userRoute / adminRoute)
src/app, src/components   UI
scripts/             migrate, seed-demo, backup, grant-role, add-chapter, purge-pickups, sweep, delete-user, e2e + browser checks
docs/                operations, safety operations, start a chapter, partner onboarding, Railway deploy, implementation notes, name
tests/               vitest suites
```

## Before launch

1. Owner decisions (full list with defaults in [docs/SAFETY-OPERATIONS.md](docs/SAFETY-OPERATIONS.md)): the **purge window** (7 days), the **visibility window** (24 hours), the **claim auto-release time** (48 hours), the **Safety page wording** (including insurance), the **partnership-note wording** ([docs/PARTNER-ONBOARDING.md](docs/PARTNER-ONBOARDING.md)) and the **email provider** (none yet).
2. Choose a name: [docs/NAME.md](docs/NAME.md).
3. Set real `CONTACT_URL` and `SECURITY_CONTACT` addresses and update `SECURITY.md` and `CODE_OF_CONDUCT.md`.
4. Create the Google OAuth client and test a real sign-in (not exercised by the automated checks).
5. Recruit coordinators, add real zones, partners and delivery sites, review and activate each chapter's sample "Winter outreach kit".
6. Set `PICKUP_ENCRYPTION_KEY`, schedule the two cron jobs (daily purge, 15-minute sweep) and rehearse a backup restore.

## Licensing

Application code: MIT (`LICENSE`). More: [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [SECURITY.md](SECURITY.md) · [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)
