# Implementation notes

## What was built (vertical slices)

0. **Restructure.** Question-bank domain removed (migration 006 drops its tables; the old app is tagged `question-bank-final`). Auth, request guard, rate limiter, CSP, health, backup, grant-role, e2e/axe harness and demo mode kept. `moderation_event` became the append-only `audit_event`.
1. **Model and stock.** Chapters, chapter roles, catalog, package templates, needs (posted and derived), zones, partners, inventory ledger, packages, hand-offs, impact.
2. **Pledges and safe pickups.** State machine, donor limits, encrypted pickup details, daytime windows, two-person rule, safety acknowledgement, visibility rule, audited views, check-in/out, overdue, purge, concern reports, email interface.
3. **API and UI.** Public board and impact, pledging, My pledges, volunteer view, coordinator dashboard, admin page, Safety/About/Guidelines/Privacy.
4. **Demo, e2e, docs.**

## Key decisions

- **Roles.** `user.role` is `member | admin`. Volunteer and coordinator are per chapter (`chapter_member`), always read from the database, never from the request. Admins can coordinate any chapter but are volunteers only if they are members of one.
- **Needs.** A *posted* need is a coordinator's target that pledges fill (received counts only pledges counted against it). A *standing* need is derived live from active templates: `target(item) = Σ (weekly target − packages assembled this week) × quantity`, and `shortfall = max(0, target − stock)`. Counting packages already assembled this week toward the target is a deliberate refinement of "target × contents − stock": without it, assembling a kit empties the shelf and the board would ask for the same socks again the same week. With nothing assembled yet the two are identical. A `need` row exists per derived item only so pledges can point at it; the board always computes live. Pledges can cover at most what is still unpledged.
- **Pledge state machine.** `pledged → scheduled → collected → received | cancelled | no_show`. A pickup cannot skip ahead (only its volunteers or a coordinator override with a reason mark it collected). Drop-offs may be counted straight from pledged. `scheduled → pledged` exists only for pickups that lose a volunteer. Pickups auto-schedule when a window is confirmed and the second volunteer is assigned.
- **Address rule** (`addressAccess`): donor always (until purge); coordinators for open pickups from 24h before the confirmed window (or the earliest preferred window until one is confirmed); assigned volunteers only when the pickup is scheduled, in the same time frame; nobody once closed (except the donor) or purged. Unrelated people get 404, not 403, so the pickup's existence is not revealed. One function decrypts; each call is audited and rate limited.
- **Closing a pickup.** Both volunteers tap Done → collected. Nobody home → no-show. Safety concern → cancelled plus a priority concern report. Other → cancelled with the note. "I can no longer make it" → only that volunteer is removed and the pickup reopens.
- **Purge clock.** `pledge.closed_at` is set the first time a pledge is collected, cancelled, no-show (or received without having been collected, for drop-offs). The purge nulls the three encrypted columns after `PICKUP_PURGE_DAYS`.
- **Append-only by triggers.** `audit_event` and `inventory_ledger` cannot be updated or deleted, except that account deletion may null `actor_id` through the foreign key. A trigger also rejects any ledger row that would take stock below zero; assembly runs in one transaction.
- **No recipient data.** No table or column for recipients; strict input schemas; a test inspects the whole schema.
- **Clock.** Services call `nowDate()` so tests can move time (`setClock`).
- **Single-process assumptions**: in-memory rate limiter, one SQLite file.

## Verification

- `npm run check`: eslint, tsc and 130 Vitest tests, including: pledge state machine, two-volunteer rule, daytime windows (and DST), address visibility (who and when) and purge, ledger and atomic assembly, needs derivation, per-chapter role scoping, and no recipient data. The safety rules were mutation-checked (breaking each rule makes tests fail).
- `npm run e2e`: HTTP walkthrough (136 checks on a demo server) plus the production-style server checks, plus the browser check (179 checks: keyboard-only flows and axe-core at 1100px and 375px, light and dark).

### What these checks do not cover

- No manual screen-reader testing or 200–400% zoom; axe finds only a subset of WCAG issues.
- **Google sign-in has not been exercised end to end** (only our side of the OAuth request). Demo mode uses password login as a substitute.
- Email is only exercised through a capturing test provider; no real provider exists yet.
- The e2e walkthrough moves a pickup window and runs the purge using the database directly, standing in for waiting days.
- No load testing, no restore drill, and the cron jobs are documented but not set up anywhere.
