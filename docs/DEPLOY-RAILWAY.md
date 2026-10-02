# Deploying OpenFrame on Railway

OpenFrame is one Node process plus one SQLite file. On Railway that means **one service with one persistent volume, one replica**.
Nothing here has been run on Railway by the authors yet: treat the first deploy as a pilot and report any step that differs.

## 1. Prerequisites
- The repo on GitHub, on the branch you want to deploy (this branch builds and passes `npm run check`).
- A Railway account with a payment method if required by your plan (check Railway's current pricing yourself).
- Optional: a domain you own. You can start on Railway's free `*.up.railway.app` address and add the domain later.
- A Google OAuth client (README → "Google sign-in"). You will need the final public URL to finish it, so deploy first, then complete Google.

## 2. Create the service
1. Railway → **New Project → Deploy from GitHub repo** → pick `openframe` and the deploy branch.
2. Railway reads `railway.json` (health check `/api/health`, start command `npm start`) and the `.node-version` file (Node 22). If the build log shows Node older than 20.9, set Railway's Node-version variable as described in Railway's docs.
3. Do **not** add a database plugin. OpenFrame does not use one.

## 3. Add the volume (do this before the first real use)
Service → **Settings → Volumes → Add Volume**, mount path `/data`. Without it all data is erased on every deploy.

## 4. Variables (Service → Variables)
| Name | Value |
|---|---|
| `BASE_URL` | the exact public URL with `https://`, no trailing slash (the Railway domain first, your domain later) |
| `AUTH_SECRET` | a random string of at least 32 characters, e.g. from `openssl rand -base64 48` |
| `DATABASE_PATH` | `/data/openframe.db` |
| `TRUST_PROXY` | `1` (required: otherwise all visitors look like one person to the rate limiters) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `INITIAL_MAINTAINER_EMAILS` | your Google email, so you become maintainer on first sign-in |
| `CONTENT_REMOVAL_CONTACT`, `SECURITY_CONTACT` | only real, monitored addresses or URLs (leave unset otherwise) |
| `NOTES_MAX_TOTAL_MB` (optional) | cap on all uploaded note files together; default 1500. Files are stored in `/data/notes` on the same volume as the database, so keep this well below the volume size (5 GB volume: the default is fine). |

Never set `OPENFRAME_DEMO` on a live site. Never put these values in the repository.

## 5. Public URL and Google
1. Service → **Settings → Networking → Generate Domain** (or **Custom Domain**, then create the DNS record Railway shows at your registrar; HTTPS is automatic).
2. Set `BASE_URL` to that URL. In Google Cloud Console → Credentials → your OAuth client, add the redirect URI `https://YOUR-URL/api/auth/callback/google`.
3. Redeploy so the new variables apply.

## 6. Verify
- `https://YOUR-URL/api/health` returns `{"status":"ok"}`.
- `/` loads with the empty-state message (production starts empty by design).
- `/auth/sign-in` shows **Continue with Google**; sign in with the Google account listed in `INITIAL_MAINTAINER_EMAILS`; `/moderation` should then open.
- Redeploy once and confirm you are still signed in and data persists (this proves the volume works).

## 7. Operating
- One replica only. A redeploy can cause a short outage because a volume attaches to one instance at a time.
- Backups: use any Railway volume-backup feature your plan offers **and** periodically copy the database file elsewhere. `npm run db:backup` writes a consistent copy; run it in a Railway shell (`railway ssh`) and download the file.
- Courses and topics are added with SQL for now (see `docs/MAINTAINERS.md`). Do this deliberately with verified course data.
- `INITIAL_MAINTAINER_EMAILS` only promotes people; removing an address does not demote anyone. Use `npm run admin:grant -- email student` to demote.
