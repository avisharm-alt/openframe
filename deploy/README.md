# Single-server deployment

This is a starter deployment for one Linux server with a persistent local disk, Node.js 22, systemd and Caddy. It keeps Next.js bound to `127.0.0.1:3000` and lets Caddy serve the public HTTPS site. Do not put the SQLite database on ephemeral storage or a network filesystem; the app uses WAL mode and an in-memory rate limiter, so run one app process on the database host.

The sample files assume `/opt/openframe`, `/var/lib/openframe`, `/var/backups/openframe`, `/etc/openframe/openframe.env`, and `/usr/bin/npm`. Check `command -v npm` and adjust the systemd units if your Node installation uses another path. Install Node.js and Caddy from their official packages for your server's distribution before continuing.

## 1. Prepare the server

Point the chosen domain's DNS record to the server. Allow inbound ports 80 and 443, and keep port 3000 private. Create a service account and persistent directories:

```sh
sudo useradd --system --home-dir /opt/openframe --shell /usr/sbin/nologin openframe
sudo install -d -o openframe -g openframe -m 0750 /opt/openframe /var/lib/openframe
sudo install -d -o openframe -g openframe -m 0700 /var/backups/openframe
sudo install -d -o root -g openframe -m 0750 /etc/openframe
sudo -u openframe git clone https://github.com/avisharm-alt/openframe.git /opt/openframe
```

Check out the intended release branch. The repository currently defaults to `claude/new-session-kn63wj`; the separate `codex/light-design` draft is not part of this deployment. From `/opt/openframe`, run the release checks and build:

```sh
cd /opt/openframe
sudo -u openframe npm ci
sudo -u openframe npm run check
sudo -u openframe npm run build
```

CI also runs the HTTP end-to-end walkthrough with `SKIP_BROWSER=1 npm run e2e`. Run it on a disposable CI/staging checkout, never against the production database: its script deletes its configured test database before seeding it.

## 2. Configure the application and HTTPS

```sh
cd /opt/openframe
sudo install -o root -g openframe -m 0640 deploy/openframe.env.example /etc/openframe/openframe.env
sudoedit /etc/openframe/openframe.env
```

Set `BASE_URL` to the exact public HTTPS origin, generate `AUTH_SECRET` with `openssl rand -base64 48`, and replace the example contact addresses with monitored ones. Keep `DATABASE_PATH` and `BACKUP_DIRECTORY` on persistent local storage. Keep `OPENFRAME_DEMO=0`. `TRUST_PROXY=1` assumes only Caddy can reach the Next.js listener and supplies the forwarding headers. The service runs `npm run deploy:preflight` before migrations and refuses example or unsafe core settings. Do not commit the filled environment file.

Install the units and enable the app and timers:

```sh
sudo install -m 0644 deploy/openframe*.service deploy/openframe*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openframe.service openframe-backup.timer openframe-purge-guests.timer
sudo systemctl status openframe.service
```

Install `deploy/Caddyfile.example` as `/etc/caddy/Caddyfile`, replace its hostname, then validate and reload Caddy. Caddy obtains and renews HTTPS certificates when the domain resolves to this server and ports 80/443 are reachable.

```sh
sudo install -m 0644 deploy/Caddyfile.example /etc/caddy/Caddyfile
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Open the public URL and verify the home page, privacy page, sign-up/sign-in, and the complete contribution → independent review → practice → report flow before inviting users. Production starts with an empty database: add verified real courses and assign at least two trusted reviewer/maintainer accounts using the commands in `docs/MAINTAINERS.md`.

## 3. Backups, restore drill, and operations

The backup timer runs daily at 03:15 server time. It creates a timestamped SQLite snapshot in `BACKUP_DIRECTORY` with mode `0600`. The guest cleanup timer runs weekly and removes guest sessions older than 30 days. Trigger and inspect the first backup immediately:

```sh
sudo systemctl start openframe-backup.service
sudo systemctl status openframe-backup.service
sudo ls -l /var/backups/openframe
```

Verify one backup by copying it to a temporary database, applying any pending migrations to that copy, and checking SQLite integrity and foreign keys:

```sh
cd /opt/openframe
sudo -u openframe npm run db:verify-backup -- /var/backups/openframe/openframe-YYYY-MM-DDTHH-mm-ss-Z.db
```

Set an off-server backup destination and a retention policy before launch. Local snapshots alone do not protect against loss of the server or disk. Backups contain account emails, password hashes, and practice history; restrict access and delete expired copies according to the privacy policy. Rehearse a full restore on staging before launch, following `docs/MAINTAINERS.md`.

For updates, take and verify a backup, deploy a reviewed commit, run `npm ci && npm run check && npm run build`, then `sudo systemctl restart openframe.service`. `ExecStartPre` applies pending migrations. Review the service logs with `journalctl -u openframe.service -e` and the timer status with `systemctl list-timers 'openframe-*'`.

This setup does not create a cloud server, register a domain, send email, or configure off-server backup storage. The owner still needs to confirm the content license and public contacts, select an email provider for verification/reset, and review the remaining launch checklist in `docs/MAINTAINERS.md`.
