/** Re-sealing stored secrets after an ENCRYPTION_KEY rotation (used by reseal-secrets and rotate-encryption-key). */
import {
  type TenantTx,
  withDbContext,
  withDbScope,
  type createPrismaClient,
} from '@dealflow/database';
import type { SecretBox } from './crypto';

const TENANT_COLUMNS = [
  {
    table: 'sso_connections',
    model: 'ssoConnection',
    column: 'client_secret_enc',
    field: 'clientSecretEnc',
  },
  { table: 'webhooks', model: 'webhook', column: 'secret_encrypted', field: 'secretEncrypted' },
  {
    table: 'integration_connections',
    model: 'integrationConnection',
    column: 'credentials_encrypted',
    field: 'credentialsEncrypted',
  },
  // Workspace apps (Slack, Zoom, DocuSign, Teams, card payments, WhatsApp, Twilio).
  {
    table: 'app_connections',
    model: 'appConnection',
    column: 'credentials_encrypted',
    field: 'credentialsEncrypted',
  },
] as const;

/** The few delegate methods used here, for any of the models above. */
interface SecretDelegate {
  findMany(args: object): Promise<Array<Record<string, string | null> & { id: string }>>;
  updateMany(args: object): Promise<{ count: number }>;
}

export type ResealCounts = Record<string, { checked: number; resealed: number }>;

/**
 * Re-seals every stored secret that was sealed with the box's previous key (see reseal-secrets for the list).
 * Each update only matches the value read, so a concurrent change is never overwritten. Throws on a value that opens
 * with neither key; nothing further is changed then.
 */
export async function resealAll(
  box: SecretBox,
  prisma: ReturnType<typeof createPrismaClient>,
  opts: { dryRun?: boolean; only?: string[] | null } = {},
): Promise<{ counts: ResealCounts; tenants: number }> {
  const dryRun = !!opts.dryRun;
  const only = opts.only ?? null;
  const want = (table: string) => !only || only.includes(table);
  const counts: ResealCounts = {};
  const count = (k: string, resealed: boolean) => {
    counts[k] ??= { checked: 0, resealed: 0 };
    counts[k].checked += 1;
    if (resealed) counts[k].resealed += 1;
  };
  const reseal = (where: string, value: string): string | null => {
    try {
      return box.needsReseal(value) ? box.seal(box.open(value)) : null;
    } catch {
      throw new Error(
        `A value in ${where} opens with neither key. Nothing further was changed; check the keys.`,
      );
    }
  };
  // users has no workspace; the guard lets the script read it directly. Each update only matches the value read,
  // so a concurrent change is never overwritten.
  const users = want('users')
    ? await prisma.user.findMany({
        where: { mfaSecretEnc: { not: null } },
        select: { id: true, mfaSecretEnc: true },
      })
    : [];
  for (const u of users) {
    const next = reseal(`users.mfa_secret_enc (${u.id})`, u.mfaSecretEnc!);
    count('users.mfa_secret_enc', !!next);
    if (next && !dryRun)
      await prisma.user.updateMany({
        where: { id: u.id, mfaSecretEnc: u.mfaSecretEnc },
        data: { mfaSecretEnc: next },
      });
  }
  // Provider keys from the operator console (ADR 0051): deployment-wide, no workspace.
  const keys = want('platform_secrets')
    ? await prisma.platformSecret.findMany({ select: { name: true, valueEnc: true } })
    : [];
  for (const k of keys) {
    const next = reseal(`platform_secrets.value_enc (${k.name})`, k.valueEnc);
    count('platform_secrets.value_enc', !!next);
    if (next && !dryRun)
      await prisma.platformSecret.updateMany({
        where: { name: k.name, valueEnc: k.valueEnc },
        data: { valueEnc: next },
      });
  }
  // Workspace collections are only reachable inside a workspace context, so each workspace is handled in its own.
  const tenantColumns = TENANT_COLUMNS.filter((c) => want(c.table));
  const tenants = !tenantColumns.length
    ? []
    : await withDbScope({ operatorScan: true }, () =>
        prisma.tenant.findMany({ select: { id: true } }),
      );
  for (const t of tenants) {
    await withDbContext(prisma, { tenantId: t.id }, async (tx: TenantTx) => {
      for (const { table, model, column, field } of tenantColumns) {
        const delegate = (tx as unknown as Record<string, SecretDelegate>)[model]!;
        const rows = await delegate.findMany({
          where: { tenantId: t.id },
          select: { id: true, [field]: true },
        });
        for (const r of rows) {
          const v = r[field];
          if (!v) continue;
          const next = reseal(`${table}.${column} (${r.id})`, v);
          count(`${table}.${column}`, !!next);
          if (next && !dryRun)
            await delegate.updateMany({ where: { id: r.id, [field]: v }, data: { [field]: next } });
        }
      }
    });
  }
  return { counts, tenants: tenants.length };
}
