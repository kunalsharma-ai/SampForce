# SampForce install package: start here

This folder installs SampForce on one Ubuntu server with Docker Compose. The full, step-by-step guide is
**[SERVER_SETUP.md](SERVER_SETUP.md)**. This page is the one-page summary for the developer doing the install.

## What you are installing

One Ubuntu 22.04 or 24.04 server (Debian 12 also works) running six containers:

| Container | What it does |
|---|---|
| `caddy` | HTTPS on ports 80 and 443, with an automatic Let's Encrypt certificate |
| `web` | The SampForce web app (Next.js, Node 26) |
| `api` | The API (NestJS on Express, Node 26) |
| `worker` | Background jobs: email, workflows, webhooks, AI runs |
| `mongo` | MongoDB 7.0, a one-member replica set with authentication and a key file |
| `migrate` | Creates the collections and indexes, then exits (runs on every start) |

Everything is built from the source in this package on the server itself. Nothing else needs to be installed
except Docker.

## What you need from the owner before you start

1. **A server**: 4 vCPU, 8 GB RAM, 40 GB SSD (2 vCPU / 4 GB works with swap), with SSH and `sudo`.
2. **A domain name** such as `crm.company.com`, with a DNS A record pointing at the server.
3. **Ports 80 and 443** open in the cloud firewall.
4. **An email address** for Let's Encrypt notices, and the email address of the first operator (admin) login.
5. **Provider keys**, only for the integrations the owner wants. These are **not** put in any file: they are
   entered after the install in the operator console under **Providers**, which shows the setup steps and the
   redirect or webhook URLs for each one. Start with SMTP so password-reset emails work.

   | Provider | Used for |
   |---|---|
   | Email (SMTP) | Password resets, invitations, client portal email |
   | Anthropic (Claude) | AI agents, email assistant, proposals, meeting and voice readings |
   | Google, Microsoft 365 | Mailbox sending and sync, calendars |
   | Apollo.io, Hunter.io | Prospect search, email finder and verification |
   | Deepgram | Transcribing meeting recordings and voice notes |
   | Slack, Zoom, DocuSign, Zapier | Workspace apps |
   | Stripe, Razorpay | Online card payments (off by default: plans are paid by invoice) |

## The install in eight commands

Details, explanations and troubleshooting for each step are in [SERVER_SETUP.md](SERVER_SETUP.md).

```bash
# 1-3. Prepare Ubuntu, firewall, Docker: SERVER_SETUP.md steps 2 and 3.
# 4. Unpack this package into /opt/sampforce
sudo mkdir -p /opt/sampforce && sudo chown "$USER" /opt/sampforce
cd /opt/sampforce && unzip -q /tmp/sampforce-selfhost.zip
cd deploy

# 5. Secrets and settings (writes .env, sampforce.env and mongo/keyfile). SAVE THE ENCRYPTION_KEY IT PRINTS.
scripts/generate-secrets.sh crm.company.com admin@company.com

# 6. Build and start (10 to 20 minutes the first time)
docker compose -f docker-compose.prod.yml up -d --build

# 7. Check it from the outside
scripts/smoke-test.sh

# 8. Operator login, then open https://crm.company.com/operator/login and add provider keys under Providers
scripts/create-operator.sh admin@company.com "Admin Name" ADMIN

# Then: create the first workspace at https://crm.company.com/signup
# and schedule the nightly backup (SERVER_SETUP.md step 9), then run one restore drill.
```

## Settings files

| File | Created by | What is in it |
|---|---|---|
| `.env` | `scripts/generate-secrets.sh` from `.env.example` | Domain, Let's Encrypt email, database passwords, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`, `OPERATOR_JWT_SECRET`, backup folder and retention. Keep it `chmod 600` and a copy in a password manager |
| `sampforce.env` | `scripts/generate-secrets.sh` from `sampforce.env.example` | Optional application settings, all with production defaults. Comment a line out rather than leaving `KEY=` empty |
| `mongo/keyfile` | `scripts/generate-secrets.sh`, once | The MongoDB replica-set key. Back it up with `.env` |

`ENCRYPTION_KEY` seals two-step verification secrets, SSO secrets, mailbox tokens and the provider keys typed
into the console. **A backup cannot be fully restored without it.**

## Day-two tasks

| Task | How |
|---|---|
| Backup now | `scripts/backup.sh` (nightly cron line in SERVER_SETUP.md step 9; copy backups off the server) |
| Restore drill | `scripts/restore.sh backups/<file>.archive.gz` (add `--switch` to make it live) |
| Update to a new version | `scripts/update.sh` (git checkout) or unpack the new zip and run `scripts/update.sh --no-pull` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f --tail=100 api worker` |
| Never | `docker compose down -v` (deletes the database volume) |

## Other files in this package

- `apps/extension/`: the Chrome extension source. The ready zip is built with
  `pnpm --filter @dealflow/extension build`; the Chrome Web Store listing text is in `apps/extension/store/`.
- `infrastructure/helm/dealflow`: a Helm chart, only if you run Kubernetes instead (see `docs/DEPLOYMENT.md`).
- `docs/runbooks/`: incident, restore, key rotation and offline payment runbooks.

Some technical names still say `dealflow` (the Docker Compose project, which names the data volumes, the Helm
chart and internal package names). That is deliberate: SampForce was called DealFlow before November 2026, and
renaming those would break existing installs.
