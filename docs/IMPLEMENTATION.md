# Implementation notes

## What was built (vertical slices)

0. **Restructure.** Question-bank domain removed (migration 006 drops its tables; the old app is tagged `question-bank-final`). Auth, request guard, rate limiter, CSP, health, backup, grant-role, e2e/axe harness and demo mode kept. `moderation_event` became the append-only `audit_event`.
1. **First care-network model** (migrations 007-008): chapters, chapter roles, catalog, zones, pledges and safe pickups. Superseded by slice 2 where noted below; the pickup safety code carried over.
2. **Partners, requests and claims** (migrations 009-010; the unlaunched pledge-era tables are dropped, not migrated): partners with delivery sites and approved workers, requests, claims, fast stock ledger, restock targets, kits, deliveries, weekly shifts, impact. Services and tests first.
3. **API and UI.** Request board and filters, claim form, My claims, agency worker portal, volunteer view (shifts, pickups, delivery run), coordinator dashboard, impact, policy pages.
4. **Demo seed, end-to-end walkthrough, browser/axe check, docs.**

## Key decisions

- **Roles.** `user.role` is `member | admin`. Volunteer and coordinator are per chapter (`chapter_member`); `agency_worker` is per partner (`partner_member`, `pending | approved`). Always read from the database, never from the request. Admins can coordinate any chapter. A worker sees only their own partner's requests.
- **Request state is derived.** `request-core.refreshRequest` recomputes it from claims and stock allocations: fully allocated → `in_transit`; fully committed (claimed plus allocated) → `claimed`; otherwise `open`. A restock request completes as `confirmed` once counted, with no delivery. A coordinator can cancel a request that is already `in_transit` (its stock goes back).
- **Claim state machine.** Pickup: `claimed → scheduled → collected → received | cancelled | no_show`; drop-off: `scheduled → received | cancelled | no_show` (drop-offs are scheduled when created, so the 48-hour release applies to pickup claims only). `scheduled → claimed` exists for a pickup that loses a volunteer, and resets the release clock. A pickup cannot skip ahead. Only the claim's volunteers or a coordinator (with a reason) mark it collected.
- **Receiving.** The ledger gets `received` first, then `allocated_to_request = min(received, still needed)` only if the request is still open or claimed and is not a restock. Anything beyond that, and any extras, stay in stock. So a claim that arrives after its request was filled from stock simply replenishes the shelf. Receive, claim status, request refresh and restock sync are one transaction.
- **Fill from stock.** Takes exactly what the request still needs off the shelf (`allocated_to_request`), or assembled kits (`assembled_into_kit`) for a kit request, and moves it to `in_transit`. Kit requests are not claimable by neighbours: the student team assembles them.
- **Restock.** `syncRestock` keeps exactly one open restock request per (chapter, item, size) below its target, sized to the shortfall, and withdraws an untouched one when stock recovers. It runs after anything that changes stock and from the sweep.
- **Deliveries.** A delivery is a batch of `in_transit` requests for one site, with volunteers. Completing it marks the requests `delivered`; the worker (or a coordinator on their behalf) confirms. Volunteers hand items to agency staff only.
- **Impact.** Time to delivery is `request.created_at → request.delivered_at` for partner requests (restock requests are excluded). Reported: median hours, share within 72 hours, share by needed-by, share from stock vs claims, fulfilled per week per chapter and partner, active neighbours (distinct claimants in 90 days), volunteer hours (pickup check-in to check-out, plus delivery run time per volunteer; shift sign-ups alone do not count).
- **Address rule** (`addressAccess`): the claiming neighbour always (until purge); coordinators for open pickups from 24 h before the confirmed window (or the earliest preferred window until one is confirmed); assigned volunteers in the same time frame once scheduled; nobody once closed (except the neighbour) or purged. Unrelated people get 404, not 403. One function decrypts; each call is audited and rate limited.
- **Closing a pickup.** Both volunteers tap Done → collected. Nobody home → no-show. Safety concern → cancelled plus a priority concern report. Other → cancelled with the note. "I can no longer make it" → only that volunteer is removed and the pickup reopens.
- **Purge clock.** `claim.closed_at` is set the first time a claim is collected, cancelled, no-show or received. The purge nulls the three encrypted columns after `PICKUP_PURGE_DAYS`.
- **Append-only by triggers.** `audit_event` and `stock_ledger` cannot be updated or deleted, except that account deletion may null `actor_id` through the foreign key. A trigger rejects any ledger row that would take stock below zero; kit assembly runs in one transaction.
- **No recipient data.** No table or column for recipients; strict input schemas; request notes are public, short (140 characters) and screened for obvious identifying text, with a warning wherever they are written; a test inspects the whole schema.
- **Shifts.** A slot recurs weekly (weekday, start, end, volunteers needed); volunteers sign up for dated occurrences up to eight weeks ahead; exam periods raise the number needed per slot; pickups and deliveries suggest volunteers on the matching shift.
- **Sweep.** One idempotent job every 15 minutes (release, expire, restock, at-risk and overdue alerts, shift reminders). The purge stays a separate daily job.
- **Clock.** Services call `nowDate()` so tests can move time (`setClock`).
- **Single-process assumptions**: in-memory rate limiter, one SQLite file.

## Verification

- `npm run check`: eslint, tsc and 185 Vitest tests, including: request and claim state machines, claim auto-release, partial claims, fill-from-stock, restock auto-requests, the two-volunteer rule, daytime windows (and DST), address visibility (who and when) and purge, stock ledger (never negative, atomic kit assembly), per-chapter and per-partner scoping, time-to-delivery, and no recipient data. The safety and stock rules were mutation-checked (breaking each rule makes tests fail).
- `npm run e2e`: HTTP walkthrough (210 checks on a demo server) plus the production-style server checks, plus the browser check (241 checks: keyboard-only flows and axe-core at 1100px and 375px, light and dark).

### What these checks do not cover

- No manual screen-reader testing or 200–400% zoom; axe finds only a subset of WCAG issues.
- **Google sign-in has not been exercised end to end** (only our side of the OAuth request). Demo mode uses password login as a substitute.
- Email is only exercised through a capturing test provider; no real provider exists yet.
- The e2e walkthrough moves a pickup window, a request's creation time and a claim's release time, and runs the purge and sweep, using the database directly, standing in for waiting hours and days.
- No load testing, no restore drill, and the cron jobs are documented but not set up anywhere.
