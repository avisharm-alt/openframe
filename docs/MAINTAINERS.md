# Maintainer guide

Everything here is done from a shell on the server (or via the moderation UI where noted). Set the same environment variables the app uses (`DATABASE_PATH` especially), or put them in `.env.local`.

## Roles

| Role | Can |
|---|---|
| student (default) | practise, bookmark, contribute, report, **permanently delete their own questions** |
| reviewer | everything above + review others' submissions, handle reports, withdraw questions |
| maintainer | everything a reviewer can + restore withdrawn questions, view the audit log, **delete any question**, **publish their own questions without review**, **read shared notes and download their files** |

Roles are granted **only** from the shell (no API, no UI), so nobody can escalate their own account:

```bash
npm run admin:grant -- someone@example.org reviewer
npm run admin:grant -- someone@example.org student      # revoke
```

Initial launch: the maintainer can review others' contributions. **Nobody can review their own submission, whatever their role.** A maintainer who wants to add content without waiting for a second person can use **Publish without review** in the question editor: it goes live at once, is labelled **Unreviewed** ("student-reviewed" means someone else checked it, which is not true here), still needs the originality statement, and is recorded in the audit log as `published_without_review`. Unreviewed questions are left out of practice by default (students tick "Include unreviewed"), so grant the reviewer role to at least one other trusted student if you want your own questions to become student-reviewed through the normal route.

## Accounts

- Sign-in is Google OAuth only; there are no passwords and no email sending. Setup steps are in the README ("Google sign-in").
- Anyone with a Google account can register, so you cannot assume users are Western students. Publication always needs a reviewer, one person can hold at most 10 pending submissions, and a person with several Google accounts can still only review others' work (roles are granted per account, by you).
- New accounts get a random display name; people can change it on `/account`. Real names and photos from Google are discarded.
- First maintainer without shell access: list your Google email in `INITIAL_MAINTAINER_EMAILS`; you are promoted at your next sign-in (verified emails only). It never demotes.
- To make someone a reviewer: they sign in once, then `npm run admin:grant -- their@email reviewer`.
- If Google sign-in breaks (expired consent screen, wrong redirect URI), guests can still browse and practise; fix the credentials and redeploy.

## Adding courses

The schema is University → Course → Unit → Topic. There is no admin UI in the MVP: insert rows with SQL (or extend `scripts/`). Real course codes/titles/mappings must be verified; do not invent outlines, instructors or syllabi. `course.is_demo=1` marks demonstration courses. A university is only visible when `university.enabled = 1`. Review the "Request a course" entries in `/moderation?tab=requests`.

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

## Shared notes (`/moderation?tab=notes`, maintainers only)

Students can privately send study notes (pasted text and/or files of any ordinary type). They are **never published or shown to anyone but the sender (title and status) and maintainers**, and are deleted automatically 180 days after they are sent, or sooner if the student or a maintainer deletes them or the account is deleted. Every send, open, download, status change and deletion is in the audit log (never with the note's content).

- Each student ticked two statements, stored with the note: the notes are their own work (not instructor slides, textbook text, or anything from an assessment), and **maintainers may use them, including by putting them into third-party AI tools, to write questions.** Honour that wording: use consented notes only, do not copy them anywhere else, do not forward them, and check the terms of any AI tool you paste them into, because that tool may keep what it receives. The consent does not allow publishing the notes themselves.
- Notes with exam-like wording or mentions of an instructor are flagged. Decline them. They are keyword hints only. If something looks like assessment content or someone else's material, decline and delete it.
- The form blocks emails, phone numbers and "student number: …" in pasted text and in titles and file names, but **it cannot look inside files**, which can carry names, file properties or photo location data. Do not publish or paste any of that into a question.
- **Files are not virus-scanned.** The app never opens or serves them except as forced, sandboxed downloads to maintainers. Open them in a sandboxed viewer or send them straight to your AI tool, and do not open unfamiliar formats on a machine holding anything sensitive. Programs, scripts and `.html`/`.svg` files are refused at upload.
- Mark a note **used** once questions have been written from it, or **declined**. Questions you write go through the normal submission flow (and need a second reviewer, or *Publish without review* as a maintainer, which labels them Unreviewed).
- **Storage:** files live in `NOTES_DIR` (default `notes/` beside the database file, so on the same volume) and **are not in `npm run db:backup`** by design, so a restored backup never brings deleted notes back. A volume-level snapshot from your host would include them until it is replaced. `NOTES_MAX_TOTAL_MB` (default 1500) is a hard cap on all stored files together; keep it well under the volume size so uploads can never fill the disk that holds the database.

## Audit log

`/moderation?tab=events` (maintainers) lists submissions, reviews, withdrawals, restores, role grants, report handling and account deletions. Entries hold no private reviewer notes and no personal data beyond the acting account reference.

## Data retention and deletion

- **Guest sessions** are stored server-side under random ids. Purge old ones from cron: `npm run admin:purge-guests -- 30` (days).
- **Account deletion** is self-service on `/account`. For a deletion request received out-of-band: `npm run admin:delete-user -- someone@example.org`. It removes sign-in, history, bookmarks, drafts and unpublished submissions; published questions remain, anonymised; reports lose the reporter link.
- **Shared notes** are deleted automatically 180 days after they are sent (checked before every note read or write, no cron job needed), when their author or a maintainer deletes them, and when the account is deleted. Their files are removed from disk at the same time, and a periodic sweep removes any file with no database record.
- **Withdrawn content** stays in the database (hidden, restorable) for audit.
- **Deleting a question** is permanent and is done in the app, not with SQL: authors can delete their own from *Contribute*, and maintainers can delete any question from *Moderation → Questions* (a reason is required and goes to the audit log; the audit entry holds no question text). If nobody has practised the question, the row is removed outright. If students have practised it, practice sessions still point at it, so its text, options, explanations, review notes, bookmarks and author link are erased and an empty anonymous shell remains; those students see "no longer available" and it is excluded from their score, exactly like a withdrawn question. Do not `DELETE` such a question with SQL: the foreign keys from practice sessions will (correctly) refuse it.

## Backups and restoration

The whole site state is one SQLite file (plus `-wal`/`-shm` while running). Uploaded note files are **not** included: they are private, short-lived, and kept out of backups on purpose.

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
- [ ] Real courses/topics inserted and verified. No demo data in production.
- [ ] Backup + restore rehearsed. Guest-session purge scheduled.
- [ ] Privacy page reviewed against what you actually run (analytics, logs, proxy logs).
- [ ] If you accept shared notes: decide who may read them and which AI tools they may be pasted into (the consent only says "may be used with third-party AI tools"), and confirm `NOTES_MAX_TOTAL_MB` is well below the volume size.
