# Maintainer guide

Everything here is done from a shell on the server (or via the moderation UI where noted). Set the same environment variables the app uses (`DATABASE_PATH` especially), or put them in `.env.local`.

## Roles

| Role | Can |
|---|---|
| student (default) | practise, bookmark, contribute, report |
| reviewer | everything above + review others' submissions, handle reports, withdraw questions |
| maintainer | everything a reviewer can + restore withdrawn questions, view the audit log |

Roles are granted **only** from the shell (no API, no UI), so nobody can escalate their own account:

```bash
npm run admin:grant -- someone@example.org reviewer
npm run admin:grant -- someone@example.org student      # revoke
```

Initial launch: the maintainer can review others' contributions. **Nobody can review their own submission, whatever their role**, so a maintainer's own questions need a second reviewer — grant the reviewer role to at least one other trusted student.

## Accounts

- Sign-in is Google OAuth only; there are no passwords and no email sending. Setup steps are in the README ("Google sign-in").
- Anyone with a Google account can register, so you cannot assume users are Western students. Publication always needs a reviewer, one person can hold at most 10 pending submissions, and a person with several Google accounts can still only review others' work (roles are granted per account, by you).
- New accounts get a random display name; people can change it on `/account`. Real names and photos from Google are discarded.
- First maintainer without shell access: list your Google email in `INITIAL_MAINTAINER_EMAILS`; you are promoted at your next sign-in (verified emails only). It never demotes.
- To make someone a reviewer: they sign in once, then `npm run admin:grant -- their@email reviewer`.
- If Google sign-in breaks (expired consent screen, wrong redirect URI), guests can still browse and practise; fix the credentials and redeploy.

## Adding and managing courses

The schema is University → Course → Unit → Topic. Maintainers manage the catalog in the browser at **Moderation → Courses** (`/moderation?tab=courses`); reviewers and students cannot. Every change is written to the audit log. Real course codes, titles, units and topics must be verified against an official source; do not invent outlines, instructors or syllabi. A university is only offered (and visible) when `university.enabled = 1`.

- **New course:** choose the university, enter the code, title and subject, and optionally paste an outline. The course goes live immediately, with no questions. Each university can use a code once (case-insensitive, archived courses included). The public URL (`/courses/<slug>`) is generated from the code at creation and never changes, even if you later edit the code.
- **Outline format:** one unit per line, with its topics on the lines below, each starting with `-`. Blank lines are ignored.

  ```
  Foundations
  - Variables and types
  - Expressions

  Control flow
  - Conditionals
  - Loops
  ```

  The same box on a course's page appends more units later; a unit title that already exists is refused and nothing is added. Errors name the line.
- **Units and topics:** add, rename, move up/down and delete from the course page. Learners pick topics from these lists when practising and contributing. A topic (or a unit containing one) that any question or revision uses can be **renamed but not deleted**, so no question is ever orphaned.
- **Archive vs delete:** *Archive* hides a course from the directory, search, practice setup and new contributions, and keeps its questions; it can be restored. Practice sessions already in progress, and direct links or bookmarks to its questions, keep working: to take a question down, use *Withdraw*. *Delete* only works for a course that never had a question (for example, one created by mistake).
- **Course requests:** `/moderation?tab=requests` lists open requests (Open / Added / Dismissed). *Create course* opens the form pre-filled from the request and marks it **added** when you create the course; *Dismiss* closes it without action and can be reopened.

Demo courses (`course.is_demo=1`) come only from the demo seed; the UI cannot create them.

## Reviewing submissions (`/moderation`)

1. Open a submission. Read the stem, every option and explanation, the check description, flags and attestation.
2. Tick every checklist item to approve: attestation, mapping, one defensible answer, correct explanations, plausible distractors, not actual assessment content, no unsupported references.
3. Approve → the revision becomes **live** and is marked *student-reviewed* with your reviewer ID, date and version. Request changes / Reject require a note the contributor can see. Private notes are visible to reviewers only.
4. Automatic flags (assessment keywords, instructor mentions, possible duplicates) are heuristics. They never prove or rule out prohibited content; you are the check.
5. "Student-reviewed" is not expert verification. Do not describe it as such.

Edits to a published question create a new revision that goes back through review. The previously approved revision stays live until the new one is approved (or the question is withdrawn). In-progress sessions keep the revision they started with unless the question is withdrawn.

## Reports and removals

- Reports (and content-removal requests) appear in `/moderation?tab=reports`; **prohibited-content and removal requests sort first**.
- A report never removes content by itself. Use *Withdraw question* (reason is logged) when warranted. Withdrawal takes effect immediately for new sessions, search, bookmarks and public endpoints; active sessions show an "unavailable" notice and the question is excluded from scoring.
- Maintainers can *restore* a withdrawn question that was previously published.
- Withdraw first, investigate second, when an item may be actual assessment content. Do not keep a copy of rejected/prohibited material outside the database and never commit it to the repository.
- Configure the public contact for removal requests with `CONTENT_REMOVAL_CONTACT` (a URL or `mailto:`). **Never put an address there that does not exist.** Until configured, the page says so honestly.

## Audit log

`/moderation?tab=events` (maintainers) lists submissions, reviews, withdrawals, restores, role grants, report handling, account deletions and every course-catalog change (courses, units, topics, requests). Entries hold no private reviewer notes and no personal data beyond the acting account reference.

## Data retention and deletion

- **Guest sessions** are stored server-side under random ids. Purge old ones from cron: `npm run admin:purge-guests -- 30` (days).
- **Account deletion** is self-service on `/account`. For a deletion request received out-of-band: `npm run admin:delete-user -- someone@example.org`. It removes sign-in, history, bookmarks, drafts and unpublished submissions; published questions remain, anonymised; reports lose the reporter link.
- **Rejected or withdrawn content**: rows remain in the database for audit. To purge a specific question entirely, delete it with SQL (`DELETE FROM question WHERE id = ?` cascades to revisions, options, reviews, bookmarks) and record why in your own maintainer log. Do this deliberately; it removes the audit trail for that item.

## Backups and restoration

The whole site state is one SQLite file (plus `-wal`/`-shm` while running).

```bash
npm run db:backup                              # writes backups/openframe-YYYY-MM-DD.db (safe while the site is running)
npm run db:backup -- /safe/place/openframe.db
```

Schedule it (cron/systemd timer) and copy backups off the machine. Backups contain personal data (emails, hashes, history): store and delete them accordingly, and remember deleted accounts persist in older backups until those expire.

**Restore:** stop the app, move the live DB (and any `-wal`/`-shm`) aside, copy the backup to `DATABASE_PATH`, start the app (pending migrations apply automatically). Check `/moderation` and a practice session. Do a restore drill before launch.

## Upgrades

`npm ci && npm run build`, restart. Migrations in `migrations/` run automatically on first DB access. If you upgrade `better-auth`, run `npm run db:gen-auth-sql`, diff `migrations/001_auth.sql`, and add any schema change as a **new** numbered migration (never edit applied ones).

## Before opening real submissions (checklist)

- [ ] Owner confirms the content license (`docs/CONTENT-LICENSE.md`) and the contributor-facing wording.
- [ ] `CONTENT_REMOVAL_CONTACT` and `SECURITY_CONTACT` point to real, monitored addresses; update `SECURITY.md` and `CODE_OF_CONDUCT.md`.
- [ ] Google OAuth client created, consent screen published, redirect URI exact; a real sign-in tested end to end with a real Google account (first sign-in, sign-out, second sign-in, account deletion).
- [ ] `AUTH_SECRET` set; HTTPS in front; `TRUST_PROXY=1` if behind a proxy; `OPENFRAME_DEMO` unset.
- [ ] At least two people hold reviewer/maintainer roles.
- [ ] Real courses/topics added (Moderation → Courses) and verified. No demo data in production.
- [ ] Backup + restore rehearsed. Guest-session purge scheduled.
- [ ] Privacy page reviewed against what you actually run (analytics, logs, proxy logs).
