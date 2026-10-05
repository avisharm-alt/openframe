# Operations

Everything here is done from a shell on the server with the app's environment variables (put them in `.env.local` locally; on Railway use `railway ssh` or a cron service with the same variables).

## Roles

| Role | Scope | How granted |
|---|---|---|
| member | everyone signed in | default |
| volunteer | one chapter | a coordinator of that chapter (Coordinate → Volunteers), or `admin:grant` |
| agency worker | one partner | they ask for access on the For partners page; a coordinator of the partner's chapter approves (Coordinate → Approvals) |
| coordinator | one chapter | an admin (Admin page), or `npm run admin:grant -- email coordinator --chapter slug` |
| admin | everything | `INITIAL_ADMIN_EMAILS` (Google-verified emails only) or `npm run admin:grant -- email admin` |

```bash
npm run admin:grant -- someone@example.org admin|member
npm run admin:grant -- someone@example.org coordinator|volunteer|none --chapter london
```

Nobody can set a role through the API for themselves. Everyone must sign in once before they can be given a role.

## Scheduled jobs (required)

| Job | Command | How often |
|---|---|---|
| Purge pickup details | `npm run admin:purge-pickups` | daily |
| Sweep | `npm run admin:sweep` | every 15 minutes |

The sweep does five things, each idempotent: it releases pickup claims nobody scheduled within `CLAIM_RELEASE_HOURS` (default 48) so the request returns to the board; expires requests a week after their needed-by date; posts and withdraws restock requests to match the restock targets; emails coordinators about requests at risk of missing their needed-by date (`REQUEST_RISK_DAYS`, default 2) and about overdue pickups; and sends shift reminders to volunteers.

Examples (crontab):

```cron
17 3 * * *    cd /app && npm run --silent admin:purge-pickups
*/15 * * * *  cd /app && npm run --silent admin:sweep
```

On Railway, add a cron service in the same project that runs these commands against the same volume-backed `DATABASE_PATH` (a volume attaches to one service, so the simplest option is to run them with `railway ssh` from an external scheduler, or from a scheduled GitHub Action that calls them over SSH). Both jobs are safe to run more often. If the purge is not scheduled, pickup details are kept longer than the privacy page promises, so check it runs. If the sweep is not scheduled, unscheduled claims are never released and nobody is alerted about at-risk requests or overdue pickups.

`npm run admin:purge-pickups -- 0` erases every closed pickup's details immediately.

## Email

Services queue messages through `src/lib/email.ts`. `EMAIL_PROVIDER=console` (default) logs `template`, a masked address and the subject, never a body or an address. `noop` is silent. To add a real provider, implement `EmailProvider { name; send(msg) }`, call `registerEmailProvider("name", factory)` at startup (for example from `src/lib/email-providers.ts` imported in `src/lib/db.ts`), and set `EMAIL_PROVIDER=name`. Delivery failures are logged and never fail the action. Messages sent: **neighbour**: claim confirmed, claim released, pickup scheduled (window + "two volunteers will come"), collected, delivered to [partner]; **agency worker**: request claimed, request in hand, delivery on the way, delivered (please confirm); **volunteer**: pickup or delivery assignment, shift reminder; **coordinators**: overdue pickup, request at risk. None contain a pickup address.

## Data, backups and keys

- One SQLite file at `DATABASE_PATH`. `npm run db:backup` writes a consistent copy while the site runs.
- `PICKUP_ENCRYPTION_KEY` encrypts pickup details. Keep it out of git and out of the same place as database backups. If you rotate or lose it, stored (still unpurged) addresses become unreadable; new ones work.
- `npm run admin:delete-user -- email` does what self-service account deletion does: cancels open claims (their requests go back on the board), erases pickup details at once, releases assignments, delivery runs and shifts.
- The audit log and stock ledger are append-only; do not try to edit them.

## Single instance

The rate limiter is in memory and SQLite is one file, so run **one instance**. Scaling out needs a shared rate-limit store and a different database.
