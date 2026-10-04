# Implementation plan and notes

## Plan (as built, in vertical slices)

1. **Course discovery + one complete practice session** — schema, catalog, practice service/API, search, setup, session player, results. ✅
2. **Contributions + moderation** — structured editor with preview, drafts, revisions, checklist review, queue. ✅
3. **Accounts + saved progress** — Better Auth, private history, bookmarks, account deletion. ✅
4. **Reports + withdrawals** — anyone can report; priority queue; withdraw/restore; audit events. ✅
5. **Final accessibility + security pass** — keyboard-only run, axe-core scans, upload/CSRF/escalation probes, CSP and request guard. ✅ (automated; see limits below)

## Key decisions / assumptions

- **Publication state vs review metadata vs report state are separate.** `question.state` = draft | pending_review | changes_requested | published | rejected | withdrawn. Review metadata (`review_status`, reviewer, date, version) is on `question_revision`. Reports have their own state machine. Seeds are *published but unreviewed*; default practice only draws *student-reviewed* questions, so demo content needs "Include unreviewed".
- **Revisions are immutable once submitted.** Only `draft` revisions are editable. "Edit" on a published/changes-requested question creates revision N+1. `question.live_revision_id` points at the approved revision served to learners. Option ids are stable across revisions (`question_option` PK = revision + option id).
- **Sessions pin revisions** (`session_question.revision_id`) and store a per-question shuffled option order of stable ids; correctness and explanations are always looked up by id, never by position.
- **Withdrawal is checked at read time** on every delivery path (`PUBLISHED` fragment; session state/answer/results re-check the question's state). Pinned revisions do not keep withdrawn questions alive.
- **Self-test never leaks**: `getSessionState` only includes `reveal` for practice-mode answered items or finished sessions; the answer endpoint returns only `{saved:true}` in self-test mode.
- **Guest sessions** are server-side (needed for server scoring) and addressed by an unguessable UUID; the browser keeps a local list for history. Signed-in sessions are private to the user (404 for anyone else).
- **No authentication via client roles.** Roles are a DB column on Better Auth's `user` table with `input:false`; changed only by `npm run admin:grant`.
- **Private course-note uploads**: authenticated multipart is allowed only at /api/course-notes, with a streamed request cap, 10 MB PDF/TXT limit, 50 MB account quota, and rate limit. Files are SQLite BLOBs, never rendered publicly; authenticated downloads are attachments available only to the owner and reviewers. Account deletion cascades to uploads. Other endpoints retain the JSON-only guard.
- **Single-process assumptions**: in-memory rate limiter; SQLite file. Fine for the MVP; document before scaling out.
- Demo mode is isolated: `OPENFRAME_DEMO=1` is required to seed, seeding refuses in production, and a banner is shown.

## Verification summary

Run on this branch (see README for commands):

- `npm run lint`, `npm run typecheck`: clean.
- `npm test`: 29 tests across practice, contribution/moderation (incl. queue cap), request-guard and auth-config suites.
- `npm run e2e`: HTTP walkthrough — 41/41 checks on a demo server (contribution → independent review → publication → practice → report → withdrawal; uploads; CSRF origin; role escalation; cross-user access; display-name rules; account deletion) plus 8/8 on a second production-style server (password login refused, valid Google OAuth start with PKCE and exact redirect URI, basic scopes only), and browser check — keyboard-only guest practice at 1100px and 375px, axe-core clean (no violations on WCAG 2.0/2.1/2.2 A/AA rule tags) on home, course, setup, session, feedback, results, policy, auth, saved, contribute, moderation, review and editor pages.
- `npm audit`: 0 known vulnerabilities at the time of writing.

### What these checks do not cover

- No manual screen-reader (NVDA/VoiceOver) or 200–400% zoom testing; axe finds only a subset of WCAG issues.
- The e2e uses a throwaway SQLite DB and the demo seed; the **demo accounts and demo content are substitutes** for real users/content, not functioning production integrations.
- **Google sign-in has not been exercised end to end.** The checks prove our side (the authorize URL, redirect URI, PKCE/state, scopes, refusal of password login, pseudonymisation mapping). The step where a real Google account approves and returns to `/api/auth/callback/google` needs real Google credentials and has not been run. Demo mode uses password login as a substitute.
- No load testing.

## Remaining launch requirements (genuine)

1. **Owner decisions:** confirm the content license and contributor wording (`docs/CONTENT-LICENSE.md`); decide on attribution defaults.
2. **Real contacts:** configure `CONTENT_REMOVAL_CONTACT` and `SECURITY_CONTACT`; update `SECURITY.md` / `CODE_OF_CONDUCT.md`.
3. **Reviewers and courses:** recruit at least two reviewers; insert verified real courses/topics (no admin UI yet).
4. **Google OAuth:** create the OAuth client, publish the consent screen, and test a real sign-in (see README).
5. **Hosting:** HTTPS, `AUTH_SECRET`, `TRUST_PROXY`, backups + restore drill, cron for guest-session purge; consider a shared rate-limit store if running more than one process.
6. **Hardening:** nonce-based CSP (currently allows inline scripts for Next.js), password re-confirmation on account deletion, pagination for large queues, manual accessibility audit with assistive tech, legal/privacy review of the policy pages.
7. **Nice-to-have next:** Docker image, admin UI for courses, reviewer notes search, per-session "report from pinned version" linkage.
