# Deploy and roll back

Status: not drilled on a cluster. Rehearse on staging first.

## Before

1. CI is green on the commit: lint, typecheck, unit, API e2e (with RLS check), browser e2e, image builds, Helm lint.
2. Read the migrations in the release (`packages/database/prisma/migrations/`). Each must work with the
   **previous** release's code still running (additive changes; drops only one release after code stops using a column).
3. Take a backup or confirm the provider snapshot from the last hour (`database-restore.md`).

## Deploy

```bash
helm upgrade dealflow infrastructure/helm/dealflow -n dealflow --reuse-values --set image.tag=<sha> --wait --timeout 15m
```

The migration Job runs first. If it fails, Helm stops and the old pods keep serving. Check
`kubectl -n dealflow logs job/dealflow-migrate`.

Watch for 15 minutes: `SampForceApiErrorRate`, p95 latency, worker last tick, sign-in failures. Sign in, open a
deal, run a report.

## Roll back

- **Code only (no migration in the release):** `helm rollback dealflow <previous-revision> -n dealflow --wait`.
- **Release had migrations:** migrations are forward-only. Rolling back the code is safe when the migrations
  were additive (the previous code ignores new columns). If a migration changed or removed something the previous
  code needs, roll **forward** with a fix. Restore from backup only for data damage, never to undo a schema change,
  because it loses every write since the backup.
- After any rollback, write down the revision and reason in the incident log.
