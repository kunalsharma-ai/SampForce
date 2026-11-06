# Incident response

## First 15 minutes

1. Name an incident lead. Open a channel and a timeline doc; write down times in UTC.
2. Decide the severity: **SEV1** data exposure across workspaces, total outage, or data loss; **SEV2** a major
   feature down for many workspaces; **SEV3** degraded or one workspace.
3. Stabilise before fixing: roll back the last deploy if it correlates (`deploy.md`), scale up, or disable the
   affected integration.

## Suspected security incident

- Preserve evidence: do not delete pods or logs. Export the relevant audit log rows (`audit_logs`,
  `platform_audit_logs`) and application logs for the window.
- **Account takeover:** suspend the membership or revoke sessions (Account security → sign out devices, or set
  `sessions.revoked_at` for the user). Ask the person to reset their password and two-step verification.
- **Leaked SCIM token:** the workspace owner revokes it under Workspace security; tokens are hashed, so a database
  read alone does not reveal working tokens.
- **Leaked `JWT_ACCESS_SECRET`:** rotate it (`key-rotation.md`). Every access token becomes invalid at once.
- **Leaked `ENCRYPTION_KEY`:** rotate it and re-seal, then rotate the underlying secrets it protected (SSO client
  secrets with each identity provider, webhook secrets, mailbox tokens by reconnecting).
- **Cross-workspace data exposure:** SEV1. Run `scripts/check-rls.sql`, confirm the runtime role has no BYPASSRLS
  (`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'dealflow_app'`), and find the code path. Customer and
  regulator notification is a legal decision; SampForce's documents make no compliance claim.

## Afterwards

Write a blameless review within five working days: timeline, impact (workspaces, records, duration), cause, what
detected it, and actions with owners. Add a test that would have caught it.
