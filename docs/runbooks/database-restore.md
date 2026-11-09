# Database backup and restore

Status: **drilled** on the build machine (one-member replica set, local disk), 2026-11-09: the load drill below on
MongoDB 8.0, and a backup, restore and switch-over of the self-host package on MongoDB 7.0.

| Drill | Documents | Data size | Archive size | Backup | Restore + verify |
|---|---|---|---|---|---|
| Scale 1 load workspace (`scripts/seed-load.ts`) | 195,023 in 126 collections | 91 MB | 11 MB | 2 s | 11 s |

The drill restored into a new database and then checked:

- Every collection had the same document count as the source.
- All 344 indexes had the same keys, uniqueness, partial filters and collation.
- The API, pointed at the restored database, signed in the load-test owner and served deals and companies.
- A second restore into the same name was refused.
- A changed archive was refused by the checksum.

Before MongoDB (ADR 0058) the same drill ran on PostgreSQL 16 with pg_dump. Real recovery time adds detection,
decision and the switch-over below. With network storage and a larger database, measure on staging and write the
number here.

## Backups

- `scripts/backup.sh` with `BACKUP_DATABASE_URL` for a user with MongoDB's built-in `backup` role
  (`sampforce_backup`) and `SAMPFORCE_DB` naming the database. It writes three files:
  - `sampforce-<UTC>.archive.gz`: a gzipped `mongodump --archive`.
  - `.sha256`: the checksum.
  - `.json`: the manifest, with the database name, the server version, the workspace count and every collection's
    document count.
- The dump is consistent per collection, not as one moment across collections, because mongodump's `--oplog` works
  only on whole-server dumps. A backup taken while people work can hold a few more documents in later collections
  than in earlier ones. For one exact moment, take it from a stopped app or a filesystem snapshot.
- Run it at least daily from a CronJob or your scheduler. Copy it to storage in another region with retention, and
  encrypt it at rest.
- Use your provider's continuous backups (Atlas, Ops Manager) as well. They give point-in-time recovery, which this
  repository does not configure or test.
- Store `ENCRYPTION_KEY` separately. Without it, restored MFA secrets, SSO client secrets, webhook secrets and
  mailbox tokens cannot be read.

## Restore

`scripts/restore.sh` never overwrites a database: it refuses a name that already exists. In order, it:

1. Checks the checksum.
2. Restores the archive under the new name (`--nsFrom/--nsTo`, `--stopOnError`).
3. Gives `sampforce_app` (through the `sampforce_runtime` role, or `readWrite` where that role does not exist) and
   `sampforce_admin` (readWrite, dbAdmin) access to the new database.
4. Verifies the result:
   - It fails if a collection the manifest counted came back empty.
   - It reports small count differences.
   - It fails if no unique indexes came back.

```bash
RESTORE_ADMIN_URL='mongodb://root:...@db-host:27017/?replicaSet=rs0&authSource=admin' \
  scripts/restore.sh sampforce-20261109T090226Z.archive.gz sampforce_restore_1109
```

`RESTORE_ADMIN_URL` must be able to create databases and grant roles: the root user, or one with `restore` and
`userAdminAnyDatabase`. The SampForce users must already exist on the target server. On a new server, create them
first, as `deploy/mongo/init-sampforce.js` does.

After a restore, run `pnpm db:setup` (the set-up Job) against the new database if the backup came from an older
release. It adds any indexes that release did not have.

## Switch the application over (Kubernetes; not drilled)

1. Decide the recovery point and tell affected customers what window of writes is lost.
2. Scale the worker to 0, then the API to 0 (`kubectl scale deploy/... --replicas=0`), so nothing writes to either
   database during the switch.
3. Run `scripts/restore.sh` into a new database and read its verification output.
4. Point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at the new database (its name is in the URL path) in the Secret.
5. Run `helm upgrade --reuse-values`. Its set-up Job creates any missing indexes and changes nothing otherwise.
6. Scale up, sign in and check a few workspaces. Keep the old database untouched until the incident is closed.
   MongoDB cannot rename a database, so the restored copy keeps its new name.

On the single-server package, `deploy/scripts/restore.sh --switch` does steps 2 to 6 by setting `SAMPFORCE_DB` in
`.env` (deploy/SERVER_SETUP.md).

A single workspace cannot be restored on its own with these scripts. Restoring one workspace's documents into the
live database needs a reviewed script that filters every collection by `tenant_id`, and none is provided.
