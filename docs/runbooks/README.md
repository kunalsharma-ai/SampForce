# Production runbooks

| Runbook | Use it when |
|---|---|
| [deploy.md](deploy.md) | Shipping a release, or rolling one back |
| [incident.md](incident.md) | Something is broken or a security event is suspected |
| [alerts.md](alerts.md) | An alert fired; one section per alert |
| [database-restore.md](database-restore.md) | Restoring from backup (data loss, corruption, drills) |
| [key-rotation.md](key-rotation.md) | Rotating `ENCRYPTION_KEY`, JWT secrets, database passwords or provider keys |
| [offline-payments.md](offline-payments.md) | A workspace has paid an invoice by bank transfer |

Status of each procedure: **drilled** means it was run end to end during Phase 8 on the build machine;
**not drilled** means it is written from the design and must be rehearsed on staging before it is relied on.

| Procedure | Status |
|---|---|
| Backup and restore into a new database, with verification | Drilled (206k rows and 1.95M rows) |
| `ENCRYPTION_KEY` rotation with re-seal | Drilled (TOTP secrets; webhook, SSO and mailbox values use the same code path but had no rows in the drill) |
| Helm install, upgrade, rollback | Not drilled (no cluster or Helm binary available) |
| Point-in-time recovery | Not drilled (provider feature) |
| JWT and database password rotation | Not drilled |
| Recording an offline payment | Tested in the browser suite against a local build; not yet done with a real bank credit |
