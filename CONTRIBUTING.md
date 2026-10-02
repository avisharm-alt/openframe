# Contributing to OpenFrame

There are two kinds of contribution: **code** (this file) and **questions** (through the site; see the in-app Contribution guidelines).

## Code

1. `npm ci`, then `npm run check` must pass before you open a PR. For changes touching auth, practice, moderation or the API also run `npm run e2e`.
2. Business rules live in `src/lib/services/*` and need a test in `tests/`. Route handlers stay thin and must use `publicRoute` / `userRoute` / `reviewerRoute` from `src/lib/http.ts` so the request guard and server-side authorisation always apply.
3. Never deliver question data without checking publication state (`PUBLISHED` fragment in `catalog.ts`). Never return the answer key or explanations from a self-test session before it is finished.
4. Keep uploads impossible: no multipart/file handling, structured JSON text only.
5. New UI needs labelled controls, visible focus, keyboard support and state that does not rely on colour alone.
6. Pin new dependencies to exact versions and run `npm audit`.
7. Do not commit real user data, `.db` files, or rejected/prohibited submissions.

## Questions

Do **not** submit professor-created exams, quizzes, tests, answer keys, screenshots, scans, copied or reconstructed assessment questions, even reworded. By contributing code you license it under MIT; by contributing questions you confirm the in-app originality and permission statement.
