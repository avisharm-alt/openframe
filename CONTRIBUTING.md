# Contributing to OpenFrame

OpenFrame is a student-run link between community partners and neighbours serving people experiencing homelessness. You can contribute **code**, **a chapter** or **a partner relationship**, or **time** as a volunteer or coordinator (through the site).

## Code

1. `npm ci`, then `npm run check` must pass before you open a PR. For changes touching auth, requests, claims, pickups, stock, roles or the API also run `npm run e2e`.
2. Business rules live in `src/lib/services/*` and need a test in `tests/`. Route handlers stay thin and must use `publicRoute` / `userRoute` / `adminRoute` from `src/lib/http.ts` so the request guard always applies. Chapter permissions are checked in the services with `requireCoordinator(actor, chapterId)` and friends, and partner permissions with `canActForPartner` / `requireAgencyWorker`, never from the request. Every query for a worker, neighbour or volunteer must be scoped to their own partner, claims or assignments.
3. **Pickup details are private.** The address, notes and phone may be decrypted only in `viewPickupDetails` (`src/lib/services/pickups.ts`), which checks who and when and writes an audit event. Never add them to any list, board, email, log or audit detail. The e2e walkthrough and tests will fail if they leak.
4. **Never store anything about the people who receive items.** No new column, table or field for recipients, and nothing in a request that could identify one (request notes are short, public and screened). `tests/no-recipient-data.test.ts` guards the schema; keep API input schemas strict.
5. Stock changes go through the stock ledger (`appendLedger`); stock must never go negative. Request status is derived in `request-core.refreshRequest`; do not set it by hand.
6. Keep uploads impossible: no multipart or file handling, structured JSON only.
7. Never edit an existing migration. Add a new numbered SQL file.
8. New UI needs labelled controls, visible focus, keyboard support, state that does not rely on colour alone, and must work at 375px. Run `npm run e2e` (browser/axe check) for UI changes.
9. Pin new dependencies to exact versions and run `npm audit`. Add no external service other than the email interface.
10. Do not commit real user data, `.db` files, or real addresses.

## A new chapter or partner

Chapters and partners are data. See [docs/START-A-CHAPTER.md](docs/START-A-CHAPTER.md) and [docs/PARTNER-ONBOARDING.md](docs/PARTNER-ONBOARDING.md).

## Volunteering

Read the in-app Safety rules first. By contributing code you license it under MIT.
