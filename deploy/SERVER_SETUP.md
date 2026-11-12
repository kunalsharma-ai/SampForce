# Setting up SampForce on your own server

This guide installs SampForce on **one Ubuntu server** (22.04 or 24.04 LTS; Debian 12 works the same way) with
Docker Compose. It takes about 30 minutes, most of it waiting for the first build.

If you run Kubernetes instead, use the Helm chart in `infrastructure/helm/dealflow` and follow
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). Everything below is for the single-server setup.

SampForce was called DealFlow before November 2026. A few technical names keep the old spelling because changing
them would break an existing install: the Docker Compose project (it names the data volumes) and the Helm chart.
Since the move to MongoDB (November 2026) the database is `sampforce` and its users are `sampforce_app`,
`sampforce_admin` and `sampforce_backup`. An install that ran on PostgreSQL cannot be upgraded in place: there is no
tool that copies PostgreSQL data into MongoDB, so a new install starts with an empty database.
An install set up under the old name in `/opt/dealflow` keeps working where it is, and
its `dealflow.env` is renamed to `sampforce.env` the first time any script in `deploy/scripts` runs.

## What gets installed

```
Internet ──443/80──▶ Caddy (TLS, automatic Let's Encrypt certificate)
                       ├── /api/v1/*  ──▶ api     (NestJS, port 4000)
                       └── everything ──▶ web     (Next.js, port 3000)
                     worker  (background jobs: email, workflows, webhooks, AI runs)
                     mongo 7.0 (one-member replica set, data in a Docker volume)
                     migrate (creates collections and indexes on every start, then exits)
```

Only Caddy is reachable from outside (ports 80 and 443). MongoDB, the API, the worker and the web server listen
on Docker's internal network only. All app containers run as a non-root user with a read-only filesystem and no
Linux capabilities.

| File in `deploy/` | What it is |
|---|---|
| `docker-compose.prod.yml` | The whole stack |
| `Caddyfile` | Reverse proxy and HTTPS |
| `.env.example` | Domain, passwords and keys. `scripts/generate-secrets.sh` turns it into `.env` (and writes `mongo/keyfile`) |
| `sampforce.env.example` | Every optional application setting, with its default. Becomes `sampforce.env` |
| `mongo/init-sampforce.js`, `mongo/start.sh`, `mongo/healthcheck.sh` | Create the database users on first start, start MongoDB as a replica set with a key file, and start the set |
| `scripts/generate-secrets.sh` | Creates `.env` with random passwords and keys |
| `scripts/create-operator.sh` | Creates an operator-console (super admin) login, or resets its password |
| `scripts/operators.sh` | Lists operator logins; disables, re-enables or changes the role of one |
| `scripts/backup.sh`, `scripts/restore.sh` | Database backup, restore and switch-over |
| `scripts/update.sh` | Backup, pull new code, rebuild, set up the database, restart |
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

Either clone the repository (if it has been made private, use a GitHub deploy key or a personal access token with read access):

```bash
sudo mkdir -p /opt/sampforce && sudo chown "$USER" /opt/sampforce
git clone https://github.com/kunalsharma-ai/sampledge_dealflow.git /opt/sampforce
```

or copy the release zip from your computer and unpack it:

```bash
scp sampforce-selfhost.zip you@your-server:/tmp/
ssh you@your-server 'sudo mkdir -p /opt/sampforce && sudo chown "$USER" /opt/sampforce && cd /opt/sampforce && unzip -q /tmp/sampforce-selfhost.zip'
```

Everything below runs in `/opt/sampforce/deploy`.

## 5. Configure

```bash
cd /opt/sampforce/deploy
scripts/generate-secrets.sh crm.yourcompany.com you@yourcompany.com
```

This writes `.env` (domain, database passwords, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`, `OPERATOR_JWT_SECRET`, all
random) and `sampforce.env` (application settings, all defaults). It prints `ENCRYPTION_KEY`:
**save it in your password manager now.** Without it, a restored backup cannot open MFA secrets, SSO secrets,
webhook secrets, mailbox tokens or the provider keys you enter in the console.

Then look through `sampforce.env`. The defaults suit production: final prices shown, offline payments only.
You do not need to put provider keys (Anthropic, Apollo, Hunter, Deepgram, Google, Microsoft, Slack, Zoom,
DocuSign, Zapier, SMTP, Stripe, Razorpay) in any file: you enter them in the operator console in step 8.

## 6. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes 10 to 20 minutes. On the first start:

1. MongoDB 7.0 starts as a one-member replica set (transactions need one) and creates three users on the `sampforce`
   database: `sampforce_app` (what the API and worker use: it can read and write documents but not drop or change indexes), `sampforce_admin` (creates
   indexes) and `sampforce_backup` (MongoDB's backup role).
2. `migrate` creates the collections, the indexes and the plan catalogue, and exits. It runs again on every `up`;
   with nothing new to do it finishes in a few seconds.
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
database, that metrics are not public, and that every container reports healthy. Workspace isolation is enforced
by SampForce's own database client, so there is no separate database check to run.

## 8. First logins

1. **Operator console (your team).** Create your admin login:

   ```bash
   scripts/create-operator.sh you@yourcompany.com "Your Name" ADMIN
   ```

   Sign in at `https://crm.yourcompany.com/operator/login`. Add a second ADMIN the same way so you are never
   locked out, and give read-only support staff the `SUPPORT` role. `scripts/operators.sh list` shows every
   login; `scripts/operators.sh disable <email>` signs someone out at once, `enable` brings them back and
   `role <email> ADMIN|SUPPORT` changes a role. The last active ADMIN cannot be disabled or demoted. To reset a
   forgotten password, run `create-operator.sh` again with the same email and role.
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

writes `backups/sampforce-<time>.archive.gz` (a compressed `mongodump`) with a `.sha256` checksum and a `.json` manifest, and deletes backups older
than `BACKUP_KEEP_DAYS` (14). It runs while SampForce is in use.

**Every day at 02:30** (crontab -e as your user):

```
30 2 * * * /opt/sampforce/deploy/scripts/backup.sh >> /opt/sampforce/deploy/backups/backup.log 2>&1
```

**Copy backups off the server.** A backup on the same disk does not survive losing the server. For example to
another machine with rsync, or to S3/Backblaze/Google Drive with [rclone](https://rclone.org):

```
45 2 * * * rsync -a /opt/sampforce/deploy/backups/ backup-user@backup-host:/srv/sampforce-backups/
```

Keep `.env` (or at least `ENCRYPTION_KEY`) in your password manager, separately from the backups.

**Restore.** Test this once after installing, and record the time it takes:

```bash
scripts/restore.sh backups/sampforce-20261102T023000Z.archive.gz            # restores into a new database and verifies it
scripts/restore.sh backups/sampforce-20261102T023000Z.archive.gz --switch   # same, then makes it the live database
```

The first form leaves the live database alone. `--switch` asks you to type `SWITCH`, stops the app for a few
seconds, sets `SAMPFORCE_DB` in `.env` to the restored database (`sampforce_restore_<time>`) and starts the app
on it. MongoDB cannot rename a database, so the old live database is kept under its own name, not deleted; the
script prints the command to drop it once you are sure. Anything entered after the backup was taken is no longer
live (it is still in the old database).
To restore onto a new server: do steps 1 to 6 with the **same `.env`** (copied from your password manager), copy
the backup into `deploy/backups/`, then run the `--switch` form. See also
[docs/runbooks/database-restore.md](../docs/runbooks/database-restore.md).

This is a nightly logical backup: at worst you lose the day's changes since the last one. If you need
point-in-time recovery, use a managed MongoDB with continuous backups (such as Atlas) and point the app at it
(ask for that variant).

## 10. Updating

```bash
scripts/update.sh              # git checkout: backup, git pull, rebuild, migrate, restart, smoke test
scripts/update.sh --no-pull    # after unpacking a new release zip over /opt/sampforce
```

Database set-up runs before the new API starts. If it fails, `up` stops and the running containers keep serving; read
`docker compose -f docker-compose.prod.yml logs migrate`.

## 11. Day to day

| Task | Command (in `/opt/sampforce/deploy`) |
|---|---|
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f --tail=100 api worker` |
| Restart one service | `docker compose -f docker-compose.prod.yml restart api` |
| Apply a changed `sampforce.env` | `docker compose -f docker-compose.prod.yml up -d` |
| Stop everything | `docker compose -f docker-compose.prod.yml down` (data volumes are kept) |
| Database shell | `docker compose -f docker-compose.prod.yml exec mongo bash -c 'mongosh -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'`, then `use sampforce` |
| Disk use | `docker system df` and `du -sh backups` |

Logs are capped at 50 MB per container. Never run `docker compose down -v`: `-v` deletes the database volume.

**Rotating `ENCRYPTION_KEY`**: follow [docs/runbooks/key-rotation.md](../docs/runbooks/key-rotation.md). Here the
steps are: put the old key in `sampforce.env` as `ENCRYPTION_KEY_PREVIOUS`, put the new one in `.env`,
`docker compose -f docker-compose.prod.yml up -d`, then
`docker compose -f docker-compose.prod.yml run --rm api node dist/cli/reseal-secrets.js --dry-run` and again
without `--dry-run`, then remove `ENCRYPTION_KEY_PREVIOUS` and run `up -d` again.

**Changing a database password**: the users are created once, from `.env` on the first start, so editing `.env`
alone breaks the connection. Change both:

```bash
docker compose -f docker-compose.prod.yml exec mongo bash -c 'mongosh -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval "db.getSiblingDB(\"admin\").changeUserPassword(\"sampforce_app\", \"new-hex-password\")"'
# set SAMPFORCE_APP_PASSWORD=new-hex-password in .env, then:
docker compose -f docker-compose.prod.yml up -d
```

The users live in the `admin` database. The same works for `sampforce_admin` and `sampforce_backup`.

Use letters and digits only (for example `openssl rand -hex 32`), because the password goes into a URL.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Browser shows a certificate error, Caddy logs `challenge failed` | DNS does not point at this server yet, or port 80 is blocked by the cloud firewall. Fix it; Caddy retries on its own |
| `api` keeps restarting, logs `Invalid API environment configuration` | A value in `sampforce.env` is malformed or empty. Comment the line out instead of leaving `KEY=` |
| `migrate` exited with an error | `docker compose -f docker-compose.prod.yml logs migrate`. The previous version keeps serving |
| Build stops with `Killed` or `JavaScript heap out of memory` | Not enough RAM: add swap (step 2) and run the build again |
| `Authentication failed` in the api, worker or migrate logs | `.env` was regenerated after the first start. Restore the original `.env`, or change the user's password (above) |
| `mongo` stays unhealthy, logs mention the key file | `mongo/keyfile` is missing or was changed. Restore it with `.env`; `scripts/generate-secrets.sh` writes it only once |
| Password-reset emails do not arrive | Add SMTP in the operator console under Providers and press Test connection |

## 13. What has and has not been tested

Tested in a sandbox with this exact compose file, on MongoDB 7.0 (last full run 10 November 2026, installed from
`sampforce-selfhost.zip` by following steps 5 to 9 as a non-root user):

- a fresh start from empty volumes, with every container healthy under the hardened settings;
- HTTPS through Caddy (with a local certificate, because a sandbox cannot get a Let's Encrypt one) and the HTTP to
  HTTPS redirect;
- sign-up, companies, contacts, leads, deals (create, move, edit, delete), tasks, activities, search, a report,
  the dashboard and the insights views;
- operator creation and console sign-in, and saving a provider key in the console (it still opened after a restore);
- a backup as a non-root user, and a restore with `--switch` (data and logins came back as of the backup; later
  data stayed in the old database);
- the password change above, and that `sampforce_app` cannot drop indexes, collections or the database;
- a full `down` / `up` keeping all data.

Not tested: a real Let's Encrypt certificate, a real Ubuntu VM, the `apt-get` step inside the images (the
sandbox cannot reach Debian mirrors, so the images were built there without it) and `scripts/update.sh` end to end. Treat your first install as the acceptance test and run
`scripts/smoke-test.sh` and a restore drill on it.
