# Contributing to OpenFrame

OpenFrame is a student-run care-package network. You can contribute **code**, **a chapter**, or **time** as a volunteer or coordinator (through the site).

## Code

1. `npm ci`, then `npm run check` must pass before you open a PR. For changes touching auth, pledges, pickups, roles or the API also run `npm run e2e`.
2. Business rules live in `src/lib/services/*` and need a test in `tests/`. Route handlers stay thin and must use `publicRoute` / `userRoute` / `adminRoute` from `src/lib/http.ts` so the request guard always applies. Chapter permissions are checked in the services with `requireCoordinator(actor, chapterId)` and friends, never from the request.
3. **Pickup details are private.** The address, notes and phone may be decrypted only in `viewPickupDetails` (`src/lib/services/pickups.ts`), which checks who and when and writes an audit event. Never add them to any list, board, email, log or audit detail. The e2e walkthrough and tests will fail if they leak.
4. **Never store anything about the people who receive packages.** No new column, table or field for recipients. `tests/no-recipient-data.test.ts` guards the schema; keep API input schemas strict.
5. Stock changes go through the inventory ledger (`appendLedger`); stock must never go negative.
6. Keep uploads impossible: no multipart or file handling, structured JSON only.
7. Never edit an existing migration. Add a new numbered SQL file.
8. New UI needs labelled controls, visible focus, keyboard support, state that does not rely on colour alone, and must work at 375px. Run `npm run e2e` (browser/axe check) for UI changes.
9. Pin new dependencies to exact versions and run `npm audit`. Add no external service other than the email interface.
10. Do not commit real user data, `.db` files, or real addresses.

## A new chapter

Chapters are data. See [docs/START-A-CHAPTER.md](docs/START-A-CHAPTER.md).

## Volunteering

Read the in-app Safety rules first. By contributing code you license it under MIT.
