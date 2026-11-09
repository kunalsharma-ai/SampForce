/**
 * Re-seals every stored secret with the current ENCRYPTION_KEY after a key rotation.
 *
 *   ENCRYPTION_KEY=<new> ENCRYPTION_KEY_PREVIOUS=<old> DATABASE_URL=<mongodb url> \
 *     node -r @swc-node/register scripts/reseal-secrets.ts [--dry-run] [--only=platform_secrets,webhooks]
 *   (production image: node dist/cli/reseal-secrets.js with the same flags)
 *
 * Covers TOTP secrets, provider keys saved in the operator console, SSO client secrets, webhook signing secrets and
 * integration and workspace app credentials. Values already
 * sealed with the new key are left alone, so the script can be re-run safely. It stops on the first value that
 * opens with neither key and prints where it is; nothing is overwritten in that case.
 */
import { createPrismaClient, type TenantTx, withDbContext, withDbScope } from '@dealflow/database';
import { SecretBox } from '../common/crypto';

const TENANT_COLUMNS = [
  { table: 'sso_connections', model: 'ssoConnection', column: 'client_secret_enc', field: 'clientSecretEnc' },
  { table: 'webhooks', model: 'webhook', column: 'secret_encrypted', field: 'secretEncrypted' },
  { table: 'integration_connections', model: 'integrationConnection', column: 'credentials_encrypted', field: 'credentialsEncrypted' },
  // Workspace apps (Slack, Zoom, DocuSign, Teams, card payments, WhatsApp, Twilio).
  { table: 'app_connections', model: 'appConnection', column: 'credentials_encrypted', field: 'credentialsEncrypted' },
] as const;

/** The few delegate methods used here, for any of the models above. */
interface SecretDelegate {
  findMany(args: object): Promise<Array<Record<string, string | null> & { id: string }>>;
  updateMany(args: object): Promise<{ count: number }>;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // --only=<table>[,<table>] re-seals just those tables (for example after a partial run).
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean) ?? null;
  const want = (table: string) => !only || only.includes(table);
  if (!process.env.ENCRYPTION_KEY) throw new Error('Set ENCRYPTION_KEY (the new key).');
  if (!process.env.ENCRYPTION_KEY_PREVIOUS) throw new Error('Set ENCRYPTION_KEY_PREVIOUS (the key being retired).');
  const box = new SecretBox({ ENCRYPTION_KEY: process.env.ENCRYPTION_KEY, ENCRYPTION_KEY_PREVIOUS: process.env.ENCRYPTION_KEY_PREVIOUS, JWT_ACCESS_SECRET: '' });
  const prisma = createPrismaClient();
  const counts: Record<string, { checked: number; resealed: number }> = {};
  const count = (k: string, resealed: boolean) => {
    counts[k] ??= { checked: 0, resealed: 0 };
    counts[k].checked += 1;
    if (resealed) counts[k].resealed += 1;
  };
  const reseal = (where: string, value: string): string | null => {
    try {
      return box.needsReseal(value) ? box.seal(box.open(value)) : null;
    } catch {
      throw new Error(`A value in ${where} opens with neither key. Nothing further was changed; check the keys.`);
    }
  };
  try {
    // users has no workspace; the guard lets the script read it directly. Each update only matches the value read,
    // so a concurrent change is never overwritten.
    const users = want('users') ? await prisma.user.findMany({ where: { mfaSecretEnc: { not: null } }, select: { id: true, mfaSecretEnc: true } }) : [];
    for (const u of users) {
      const next = reseal(`users.mfa_secret_enc (${u.id})`, u.mfaSecretEnc!);
      count('users.mfa_secret_enc', !!next);
      if (next && !dryRun) await prisma.user.updateMany({ where: { id: u.id, mfaSecretEnc: u.mfaSecretEnc }, data: { mfaSecretEnc: next } });
    }
    // Provider keys from the operator console (ADR 0051): deployment-wide, no workspace.
    const keys = want('platform_secrets') ? await prisma.platformSecret.findMany({ select: { name: true, valueEnc: true } }) : [];
    for (const k of keys) {
      const next = reseal(`platform_secrets.value_enc (${k.name})`, k.valueEnc);
      count('platform_secrets.value_enc', !!next);
      if (next && !dryRun) await prisma.platformSecret.updateMany({ where: { name: k.name, valueEnc: k.valueEnc }, data: { valueEnc: next } });
    }
    // Workspace collections are only reachable inside a workspace context, so each workspace is handled in its own.
    const tenantColumns = TENANT_COLUMNS.filter((c) => want(c.table));
    const tenants = !tenantColumns.length ? [] : await withDbScope({ operatorScan: true }, () => prisma.tenant.findMany({ select: { id: true } }));
    for (const t of tenants) {
      await withDbContext(prisma, { tenantId: t.id }, async (tx: TenantTx) => {
        for (const { table, model, column, field } of tenantColumns) {
          const delegate = (tx as unknown as Record<string, SecretDelegate>)[model]!;
          const rows = await delegate.findMany({ where: { tenantId: t.id }, select: { id: true, [field]: true } });
          for (const r of rows) {
            const v = r[field];
            if (!v) continue;
            const next = reseal(`${table}.${column} (${r.id})`, v);
            count(`${table}.${column}`, !!next);
            if (next && !dryRun) await delegate.updateMany({ where: { id: r.id, [field]: v }, data: { [field]: next } });
          }
        }
      });
    }
    console.warn(`${dryRun ? 'Dry run, nothing written. ' : ''}${tenants.length} workspaces checked.`);
    for (const [k, c] of Object.entries(counts)) console.warn(`${k}: ${c.checked} checked, ${c.resealed} re-sealed`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
