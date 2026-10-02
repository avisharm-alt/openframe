# Security policy

## Reporting a vulnerability

**The maintainers have not configured a public security contact yet** — set `SECURITY_CONTACT` (see `.env.example`) and replace this paragraph with the real address or private advisory link **before launch**. Until then, do not open public issues containing exploit details.

When you report, please include affected URL/endpoint, steps to reproduce and impact. Do not access other users' data, and do not test against production data.

## Design notes

- Authorisation is enforced server-side in `src/lib/services/*` and `src/lib/http.ts`. Roles live in the database and can only be changed with shell access (`npm run admin:grant`).
- All `/api` writes: JSON only (uploads are rejected with 415), 100 KB body cap, same-origin check, SameSite=Lax httpOnly session cookie.
- Contributed Markdown cannot contain raw HTML, scripts or images; links are limited to http(s) and are never fetched. CSP additionally blocks remote images/frames.
- Rate limits: Better Auth's limiter for sign-in/sign-up; an in-memory limiter for sessions, submissions, reports and course requests (single-process only).
- Known hardening gaps: CSP still allows inline scripts (Next.js inline bootstrap; nonce-based CSP is future work); no email verification or password reset; account deletion does not re-ask for the password.
