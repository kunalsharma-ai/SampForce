# Database backup and restore

Status: **drilled** on the build machine (PostgreSQL 16, local disk, 4 parallel restore jobs).

| Drill | Rows | Database size | Dump size | Backup | Restore + verify |
|---|---|---|---|---|---|
| Dev data | 205,938 in 66 tables | 21 MB+ | 11 MB | 1 s | 1.6 s |
| Scale 10 load workspace | 1,950,034 | 594 MB | 85 MB | 7 s | 8 s |

Both drills: row counts identical in every table, RLS check passed, the runtime role saw no rows without a tenant
context, the API served the restored data (responses compared with the source, identical apart from timestamps
and new sign-in audit rows). Real recovery time adds detection, decision and the switch-over below; with network
storage and a larger database, measure on staging and write the number here.

## Backups

- `scripts/backup.sh` with `BACKUP_DATABASE_URL` for the `dealflow_backup` role (read-only, BYPASSRLS). Output:
  `dealflow-<UTC>.dump` (pg_dump custom format), `.sha256` and `.json` (size, duration, last migration, tenant count).
- Run it at least daily from a CronJob or your scheduler, copy to storage in another region with retention, and
  encrypt at rest. Use your provider's PITR in addition; it is not configured or tested by this repository.
- Store `ENCRYPTION_KEY` separately: without it, restored MFA secrets, SSO client secrets, webhook secrets and
  mailbox tokens cannot be read.

## Restore

`scripts/restore.sh` never overwrites a database. It refuses an existing name, checks the checksum, creates a new
database owned by `dealflow_owner`, restores in parallel, analyses, and verifies.

```bash
RESTORE_ADMIN_URL=postgresql://admin@db-host:5432/postgres scripts/restore.sh dealflow-20261031T041156Z.dump dealflow_restore_1031
```

`RESTORE_ADMIN_URL` must be able to create databases and load into tables with forced RLS (a superuser, or CREATEDB
and BYPASSRLS). The three SampForce roles must exist on the target server.

## Switch the application over (not drilled)

1. Decide the recovery point and tell affected customers what window of writes is lost.
2. Scale the worker to 0, then the API to 0 (`kubectl scale deploy/... --replicas=0`), so nothing writes to either
   database during the switch.
3. Run `scripts/restore.sh` into a new database and read its verification output.
4. Point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at the new database in the Secret.
5. `helm upgrade --reuse-values` (runs `migrate deploy`, which is a no-op when the dump is from the same release).
6. Scale up, sign in, check a few workspaces, then keep the old database untouched until the incident is closed.

A single workspace cannot be restored on its own with these scripts; restoring one tenant's rows into the live
database needs a reviewed, per-table script and is not provided.
