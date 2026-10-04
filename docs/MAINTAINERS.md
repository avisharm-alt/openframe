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

**Nobody can review a question they wrote or edited, whatever their role**, and a question is only verified or published after **two different** reviewers approve it. You therefore need at least **three** people with reviewer/maintainer roles before a reviewer's own contribution can be published, and at least two to verify the imported questions. Grant the reviewer role generously to trusted students.

## Accounts

- Sign-in is Google OAuth only; there are no passwords and no email sending. Setup steps are in the README ("Google sign-in").
- Anyone with a Google account can register, so you cannot assume users are Western students. Publication always needs a reviewer, one person can hold at most 10 pending submissions, and a person with several Google accounts can still only review others' work (roles are granted per account, by you).
- New accounts get a random display name; people can change it on `/account`. Real names and photos from Google are discarded.
- First maintainer without shell access: list your Google email in `INITIAL_MAINTAINER_EMAILS`; you are promoted at your next sign-in (verified emails only). It never demotes.
- To make someone a reviewer: they sign in once, then `npm run admin:grant -- their@email reviewer`.
- If Google sign-in breaks (expired consent screen, wrong redirect URI), guests can still browse and practise; fix the credentials and redeploy.

## Adding courses

The schema is University → Course → Unit → Topic. The bundled Western bank imports automatically on first database use. See `content/README.md` for idempotent imports and retaining private source evidence. There is no course admin UI in the MVP: add other courses with SQL (or extend `scripts/`). Real course codes/titles/mappings must be verified; do not invent outlines, instructors or syllabi. `course.is_demo=1` marks demonstration courses. A university is only visible when `university.enabled = 1`. Review the "Request a course" entries in `/moderation?tab=requests`.

## Reviewing and verifying (`/moderation`)

There are two queues. **Submissions** holds new questions and edits from contributors. **Needs verification** holds published questions that are still labelled Unverified, above all the AI-generated Western imports. Both work the same way.

1. Open an item (or press "Start reviewing" on the Needs verification tab to work through the queue). The answer key is hidden: choose your own answer first (press `1`–`5`), then the key and explanations appear. If you skip this you cannot tick the first checklist item or approve.
2. Tick every checklist item to approve: you independently worked out the answer first, plus attestation, mapping, one defensible answer, correct explanations, plausible distractors, not actual assessment or instructor-material content, no unsupported references. `t` ticks the lot once you have seen the key.
3. Approve (`a`). The first approval is recorded and the question waits; the **second approval from a different reviewer** verifies it (for a submission it also publishes it). Your display name and the date are shown publicly on the question. Request changes (`c`) needs a note; on a live unverified question it blocks verification until the objection is withdrawn or the question is edited. Reject (`r`, press twice) withdraws a published question or closes a submission; give a reason.
4. Found a mistake? Press `e` to edit. Your edit is saved as a **new revision credited to you**; you can then no longer review that question, and two other reviewers must approve the edit before it replaces the live version.
5. Other keys: `n`/`p` next/previous question, `Esc` leaves a text box. Shortcuts can be switched off with the "Keyboard shortcuts" tickbox and never fire while you are typing.
6. Automatic flags (assessment keywords, instructor mentions, possible duplicates) are heuristics. They never prove or rule out prohibited content; you are the check.
7. "Verified" is not expert verification or instructor approval. Do not describe it as such.

**Weak items** (`/moderation?tab=weak`) shows aggregate answer statistics per question and flags ones to re-open: at least 30 attempts and over 95% or under 25% correct, or a wrong option picked more often than the key. Flags are prompts for a human look, not proof of an error. Only totals are shown, never individual answers.

Edits to a published question create a new revision that goes back through review. The previously approved revision stays live until the new one is approved (or the question is withdrawn). In-progress sessions keep the revision they started with unless the question is withdrawn.

## Reports and removals

- Reports (and content-removal requests) appear in `/moderation?tab=reports`; **prohibited-content and removal requests sort first**.
- A report never removes content by itself. Use *Withdraw question* (reason is logged) when warranted. Withdrawal takes effect immediately for new sessions, search, bookmarks and public endpoints; active sessions show an "unavailable" notice and the question is excluded from scoring.
- Maintainers can *restore* a withdrawn question that was previously published.
- Withdraw first, investigate second, when an item may be actual assessment content. Do not keep a copy of rejected/prohibited material outside the database and never commit it to the repository.
- Configure the public contact for removal requests with `CONTENT_REMOVAL_CONTACT` (a URL or `mailto:`). **Never put an address there that does not exist.** Until configured, the page says so honestly.

## Audit log

`/moderation?tab=events` (maintainers) lists submissions, reviews, withdrawals, restores, role grants, report handling and account deletions. Entries hold no private reviewer notes and no personal data beyond the acting account reference.

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

- [ ] Owner confirms the content license (`docs/CONTENT-LICENSE.md`, currently a CC BY 4.0 proposal) and the contributor-facing wording, and decides what to do about the bundled Western banks.
- [ ] `CONTENT_REMOVAL_CONTACT` and `SECURITY_CONTACT` point to real, monitored addresses; update `SECURITY.md` and `CODE_OF_CONDUCT.md`.
- [ ] Google OAuth client created, consent screen published, redirect URI exact; a real sign-in tested end to end with a real Google account (first sign-in, sign-out, second sign-in, account deletion).
- [ ] `AUTH_SECRET` set; HTTPS in front; `TRUST_PROXY=1` if behind a proxy; `OPENFRAME_DEMO` unset.
- [ ] At least three people hold reviewer/maintainer roles (two approvals are needed per question, and nobody reviews their own).
- [ ] Real courses/topics inserted and verified. No demo data in production.
- [ ] Backup + restore rehearsed. Guest-session purge scheduled.
- [ ] Privacy page reviewed against what you actually run (analytics, logs, proxy logs).

## Course notes (feature flag)

Course-notes uploads are **off by default** because instructor slides and notes are usually copyrighted. Set `OPENFRAME_NOTES_UPLOADS=1` to turn them on. While off, the nav link and the `/course-notes` page are gone, every `/api/course-notes` request (upload, download, delete, signed in or not) returns 404, the moderation "Course notes" tab is hidden, and files already uploaded are left exactly as they are in the database (nothing is deleted or modified; turning the flag back on restores access).

When on, students upload private PDF or UTF-8 text notes from /course-notes after confirming that the file is their **own** notes, not instructor slides, handouts or past assessments (the confirmation text is stored with each upload; uploads made before this wording have no stored confirmation). Reviewers and maintainers can download them in /moderation?tab=notes. Uploads do not generate or publish questions automatically. Files are stored in SQLite, covered by the same persistent volume and backups; removed uploads may remain in retained backups. Limits are 10 MB per file, 50 MB per account and five upload attempts per hour. Downloads are attachments; inspect files using your normal document tools.

To remove files that should not be held, delete the rows with SQL (`DELETE FROM course_note WHERE id = ?`); account deletion also removes a person's uploads.
