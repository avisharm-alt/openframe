# Security policy

## Reporting a vulnerability

**The maintainers have not configured a public security contact yet** — set `SECURITY_CONTACT` (see `.env.example`) and replace this paragraph with the real address or private advisory link **before launch**. Until then, do not open public issues containing exploit details.

When you report, please include affected URL/endpoint, steps to reproduce and impact. Do not access other users' data, and do not test against production data.

## Design notes

- Authorisation is enforced server-side in `src/lib/services/*` and `src/lib/http.ts`. Roles live in the database and can only be changed with shell access (`npm run admin:grant`).
- All `/api` writes: JSON only (uploads are rejected with 415), 100 KB body cap, same-origin check, SameSite=Lax httpOnly session cookie. The single exception is `POST /api/notes` (private study notes): `multipart/form-data` only, declared size required and capped (40 MB of files per request, 5 files, 15 MB each, 100 MB per person, and a global cap that protects the database volume). Programs, scripts and browser-runnable files (.html, .svg) are refused by extension and by file signature. Files are stored outside the database under random names, are never opened, parsed or served by the app except to maintainers, and then only as forced, sandboxed downloads (`attachment`, `application/octet-stream`, `nosniff`, `Content-Security-Policy: sandbox`). **Residual risk: uploaded files are not virus-scanned.** Maintainers should open them in a sandboxed viewer; see `docs/MAINTAINERS.md`.
- Contributed Markdown cannot contain raw HTML, scripts or images; links are limited to http(s) and are never fetched. CSP additionally blocks remote images/frames.
- Accounts: Google OAuth only in production (state + PKCE handled by Better Auth); password login exists only in demo mode. Real names/photos from Google are discarded; OAuth tokens are encrypted at rest. At most 10 pending submissions per author.
- Rate limits: Better Auth's limiter for sign-in/sign-up; an in-memory limiter for sessions, submissions, reports and course requests (single-process only).
- Known hardening gaps: CSP still allows inline scripts (Next.js inline bootstrap; nonce-based CSP is future work); account deletion does not re-ask for the password.
