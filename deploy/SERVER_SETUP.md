# Setting up DealFlow on your own server

This guide installs DealFlow on **one Ubuntu server** (22.04 or 24.04 LTS; Debian 12 works the same way) with
Docker Compose. It takes about 30 minutes, most of it waiting for the first build.

If you run Kubernetes instead, use the Helm chart in `infrastructure/helm/dealflow` and follow
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). Everything below is for the single-server setup.

## What gets installed

```
Internet ──443/80──▶ Caddy (TLS, automatic Let's Encrypt certificate)
                       ├── /api/v1/*  ──▶ api     (NestJS, port 4000)
                       └── everything ──▶ web     (Next.js, port 3000)
                     worker  (background jobs: email, workflows, webhooks, AI runs)
                     postgres 16 (data in a Docker volume)
                     migrate (runs database migrations on every start, then exits)
```

Only Caddy is reachable from outside (ports 80 and 443). Postgres, the API, the worker and the web server listen
on Docker's internal network only. All app containers run as a non-root user with a read-only filesystem and no
Linux capabilities.

| File in `deploy/` | What it is |
|---|---|
| `docker-compose.prod.yml` | The whole stack |
| `Caddyfile` | Reverse proxy and HTTPS |
| `.env.example` | Domain, passwords and keys. `scripts/generate-secrets.sh` turns it into `.env` |
| `dealflow.env.example` | Every optional application setting, with its default. Becomes `dealflow.env` |
| `postgres/init-dealflow.sh` | Creates the database roles on first start |
| `scripts/generate-secrets.sh` | Creates `.env` with random passwords and keys |
| `scripts/create-operator.sh` | Creates your operator-console login |
| `scripts/backup.sh`, `scripts/restore.sh` | Database backup, restore and switch-over |
| `scripts/update.sh` | Backup, pull new code, rebuild, migrate, restart |
| `scripts/smoke-test.sh` | Checks the running install from the outside |

## 1. The server

**Size.** 4 vCPU, 8 GB RAM, 40 GB SSD is comfortable for a few hundred users. 2 vCPU and 4 GB RAM runs it, but
add 4 GB of swap (step 2) because building the web app needs about 3 GB of memory.

**You need before you start:**

- A server with a public IP address and SSH access as a user with `sudo`.
- A domain name, for example `crm.yourcompany.com`. Create a DNS **A record** pointing it at the server's IP
  (and an AAAA record if the server has IPv6). Check with `dig +short crm.yourcompany.com`.
- Ports 80 and 443 open to the internet in your cloud provider's firewall or security group. Caddy needs port 80
  to obtain the certificate.
- An email address for Let's Encrypt certificate notices.

## 2. Prepare Ubuntu

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl git openssl unattended-upgrades ufw
sudo dpkg-reconfigure -plow unattended-upgrades     # automatic security updates (answer Yes)

# Firewall: SSH, HTTP, HTTPS only.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
```

Only if the server has less than 8 GB of RAM, add swap:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Install Docker

Docker's own packages (not the `docker.io` package from Ubuntu, which lacks the Compose plugin):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"     # then log out and back in, so docker works without sudo
docker compose version              # should print v2.20 or newer
```

On Debian, replace `ubuntu` with `debian` in both URLs.

## 4. Get the code onto the server

Either clone the repository (it is private, so use a GitHub deploy key or a personal access token with read access):

```bash
sudo mkdir -p /opt/dealflow && sudo chown "$USER" /opt/dealflow
git clone https://github.com/kunalsharma-ai/sampledge_dealflow.git /opt/dealflow
```

or copy the release zip from your computer and unpack it:

```bash
scp dealflow-selfhost.zip you@your-server:/tmp/
ssh you@your-server 'sudo mkdir -p /opt/dealflow && sudo chown "$USER" /opt/dealflow && cd /opt/dealflow && unzip -q /tmp/dealflow-selfhost.zip'
```

Everything below runs in `/opt/dealflow/deploy`.

## 5. Configure

```bash
cd /opt/dealflow/deploy
scripts/generate-secrets.sh crm.yourcompany.com you@yourcompany.com
```

This writes `.env` (domain, database passwords, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`, `OPERATOR_JWT_SECRET`, all
random) and `dealflow.env` (application settings, all defaults). It prints `ENCRYPTION_KEY`:
**save it in your password manager now.** Without it, a restored backup cannot open MFA secrets, SSO secrets,
webhook secrets, mailbox tokens or the provider keys you enter in the console.

Then look through `dealflow.env`. The defaults suit production: final prices shown, offline payments only.
You do not need to put provider keys (Anthropic, Apollo, Hunter, Deepgram, Google, Microsoft, Slack, Zoom,
DocuSign, Zapier, SMTP, Stripe, Razorpay) in any file: you enter them in the operator console in step 8.

## 6. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes 10 to 20 minutes. On the first start:

1. Postgres creates the `dealflow` database and three roles: `dealflow_owner` (owns the schema),
   `dealflow_app` (what the app uses, **without** permission to bypass row-level security) and `dealflow_backup`
   (read-only, for backups).
2. `migrate` applies every database migration and exits. It runs again on every `up`; with nothing new to apply it
   finishes in a second.
3. The API, worker and web app start. Caddy waits for the web app to be healthy, then requests the certificate.

Follow progress with `docker compose -f docker-compose.prod.yml ps` and
`docker compose -f docker-compose.prod.yml logs -f`. Containers restart on their own after a reboot.

There is no demo data in production: the demo seed refuses to run with `NODE_ENV=production`. Your first workspace
is created by signing up (step 8).

## 7. Check it works

```bash
scripts/smoke-test.sh
```

It checks the HTTP to HTTPS redirect, the web app, the login and pricing pages, that the API reaches the
database, that metrics are not public, and that every container reports healthy. Then confirm row-level security
is in force:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d dealflow -v ON_ERROR_STOP=1 < ../scripts/check-rls.sql
```

## 8. First logins

1. **Operator console (your team).** Create your admin login:

   ```bash
   scripts/create-operator.sh you@yourcompany.com "Your Name" ADMIN
   ```

   Sign in at `https://crm.yourcompany.com/operator/login`.
2. **Integrations.** In the console open **Providers**. Every integration is set up there: open **How to set up …**
   on a provider for the steps, a link to its console and the redirect or webhook URLs to copy into it, then
   **Add keys** and **Test connection**. Keys apply within 10 seconds, no restart. Add SMTP first so password-reset
   emails work. Online payments, price ids, the AI model and the pricing page are under **Plans and online
   checkout** and **Anthropic**. For Stripe, Razorpay, Zoom and DocuSign the card also shows when a signed webhook
   has arrived. The bottom of the page lists the few settings that stay in the `.env` file, and why.
3. **Bank details.** Console **Settings**: the payment instructions printed on offline invoices.
4. **First workspace.** Open `https://crm.yourcompany.com/signup` and create your company's workspace. Turn on
   two-step verification under your account, sign out and back in.

## 9. Backups

```bash
scripts/backup.sh
```

writes `backups/dealflow-<time>.dump` with a `.sha256` checksum and a `.json` manifest, and deletes backups older
than `BACKUP_KEEP_DAYS` (14). It runs while DealFlow is in use.

**Every day at 02:30** (crontab -e as your user):

```
30 2 * * * /opt/dealflow/deploy/scripts/backup.sh >> /opt/dealflow/deploy/backups/backup.log 2>&1
```

**Copy backups off the server.** A backup on the same disk does not survive losing the server. For example to
another machine with rsync, or to S3/Backblaze/Google Drive with [rclone](https://rclone.org):

```
45 2 * * * rsync -a /opt/dealflow/deploy/backups/ backup-user@backup-host:/srv/dealflow-backups/
```

Keep `.env` (or at least `ENCRYPTION_KEY`) in your password manager, separately from the backups.

**Restore.** Test this once after installing, and record the time it takes:

```bash
scripts/restore.sh backups/dealflow-20261102T023000Z.dump            # restores into a new database and verifies it
scripts/restore.sh backups/dealflow-20261102T023000Z.dump --switch   # same, then makes it the live database
```

The first form leaves the live database alone. `--switch` asks you to type `SWITCH`, stops the app for a few
seconds, renames the live database to `dealflow_before_<time>` (kept, not deleted) and puts the restored one in its
place. Anything entered after the backup was taken is no longer live (it is still in `dealflow_before_<time>`).
To restore onto a new server: do steps 1 to 6 with the **same `.env`** (copied from your password manager), copy
the backup into `deploy/backups/`, then run the `--switch` form. See also
[docs/runbooks/database-restore.md](../docs/runbooks/database-restore.md).

This is a nightly logical backup: at worst you lose the day's changes since the last one. If you need
point-in-time recovery, use a managed Postgres with PITR and point the app at it (ask for that variant).

## 10. Updating

```bash
scripts/update.sh              # git checkout: backup, git pull, rebuild, migrate, restart, smoke test
scripts/update.sh --no-pull    # after unpacking a new release zip over /opt/dealflow
```

Migrations run before the new API starts. If one fails, `up` stops and the running containers keep serving; read
`docker compose -f docker-compose.prod.yml logs migrate`.

## 11. Day to day

| Task | Command (in `/opt/dealflow/deploy`) |
|---|---|
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f --tail=100 api worker` |
| Restart one service | `docker compose -f docker-compose.prod.yml restart api` |
| Apply a changed `dealflow.env` | `docker compose -f docker-compose.prod.yml up -d` |
| Stop everything | `docker compose -f docker-compose.prod.yml down` (data volumes are kept) |
| Database shell | `docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d dealflow` |
| Disk use | `docker system df` and `du -sh backups` |

Logs are capped at 50 MB per container. Never run `docker compose down -v`: `-v` deletes the database volume.

**Rotating `ENCRYPTION_KEY`**: follow [docs/runbooks/key-rotation.md](../docs/runbooks/key-rotation.md). Here the
steps are: put the old key in `dealflow.env` as `ENCRYPTION_KEY_PREVIOUS`, put the new one in `.env`,
`docker compose -f docker-compose.prod.yml up -d`, then
`docker compose -f docker-compose.prod.yml run --rm api node dist/cli/reseal-secrets.js --dry-run` and again
without `--dry-run`, then remove `ENCRYPTION_KEY_PREVIOUS` and run `up -d` again.

**Changing a database password**: the roles are created once, from `.env` on the first start, so editing `.env`
alone breaks the connection. Change both:

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "ALTER ROLE dealflow_app PASSWORD 'new-hex-password'"
# set DEALFLOW_APP_PASSWORD=new-hex-password in .env, then:
docker compose -f docker-compose.prod.yml up -d
```

Use letters and digits only (for example `openssl rand -hex 32`), because the password goes into a URL.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Browser shows a certificate error, Caddy logs `challenge failed` | DNS does not point at this server yet, or port 80 is blocked by the cloud firewall. Fix it; Caddy retries on its own |
| `api` keeps restarting, logs `Invalid API environment configuration` | A value in `dealflow.env` is malformed or empty. Comment the line out instead of leaving `KEY=` |
| `migrate` exited with an error | `docker compose -f docker-compose.prod.yml logs migrate`. The previous version keeps serving |
| Build stops with `Killed` or `JavaScript heap out of memory` | Not enough RAM: add swap (step 2) and run the build again |
| `password authentication failed for user "dealflow_app"` | `.env` was regenerated after the first start. Restore the original `.env`, or change the role password (above) |
| Password-reset emails do not arrive | Add SMTP in the operator console under Providers and press Test connection |

## 13. What has and has not been tested

Tested in a sandbox with this exact compose file: a fresh start from an empty volume, migrations, every container
healthy under the hardened settings, HTTPS through Caddy (with a local certificate, because a sandbox cannot get a
Let's Encrypt one), HTTP to HTTPS redirect, sign-up, creating a deal, operator creation, console sign-in and saving a provider key, a backup as a
non-root user, a restore with `--switch` (data, logins and console keys came back as of the backup), and a full
`down` / `up` keeping all data. Not tested: a real Let's Encrypt certificate, a real Ubuntu VM and the
`apt-get` step inside the images (the sandbox cannot reach Debian mirrors). Treat your first install as the
acceptance test and run `scripts/smoke-test.sh` and a restore drill on it.
