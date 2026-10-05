# Security policy

## Reporting a vulnerability

**The maintainers have not configured a public security contact yet.** Set `SECURITY_CONTACT` (see `.env.example`) and replace this paragraph with the real address or private advisory link **before launch**. Until then, do not open public issues containing exploit details.

When you report, include the affected URL/endpoint, steps to reproduce and impact. Do not access other people's data, and do not test against production data. Anything touching pickup addresses is especially sensitive.

## Design notes

- **Authorisation** is enforced server-side in `src/lib/services/*` and `src/lib/http.ts`. The global role (`member` | `admin`) lives on the user record and changes only with shell access or by an admin. Chapter roles live in `chapter_member` and are checked per chapter on every call: a coordinator of one chapter cannot act on another. Agency workers live in `partner_member`, are approved by a coordinator of the partner's chapter, and can act only for their own partner.
- **Pickup details** (address, access notes, phone) are encrypted at rest with AES-256-GCM (key derived from `PICKUP_ENCRYPTION_KEY`; the row id is bound as authenticated data). They are decrypted in one function that applies the visibility rules, rate limits views and writes an audit event for each. They are purged 7 days (configurable) after a claim is collected, cancelled or a no-show, and at once on account deletion. They never appear in lists, emails, logs or the audit log.
- **No recipient data** is stored anywhere. Input schemas are strict, so extra fields are rejected. Request notes are short, public and screened for obvious identifying text, but partners are responsible for what they write.
- **Audit log** (`audit_event`) and the **stock ledger** are append-only, enforced by database triggers.
- All `/api` writes: JSON only (uploads are rejected with 415), 100 KB body cap, same-origin check, SameSite=Lax httpOnly session cookie.
- Accounts: Google OAuth only in production (state + PKCE handled by Better Auth); password login exists only in demo mode. Real names and photos from Google are discarded; OAuth tokens are encrypted at rest.
- Rate limits: Better Auth's limiter for sign-in/sign-up; an in-memory limiter for claims, requests, address views and concern reports (single-process only).
- Known gaps: CSP still allows inline scripts (Next.js inline bootstrap; nonce-based CSP is future work); account deletion does not re-confirm with Google; the in-memory rate limiter does not work across several instances; losing `PICKUP_ENCRYPTION_KEY` makes stored pickup details unreadable (acceptable: they are short-lived).
