/**
 * Re-seals every stored secret with the current ENCRYPTION_KEY after a key rotation.
 *
 *   ENCRYPTION_KEY=<new> ENCRYPTION_KEY_PREVIOUS=<old> DATABASE_URL=<runtime role> \
 *     node -r @swc-node/register scripts/reseal-secrets.ts [--dry-run]
 *
 * Covers TOTP secrets, SSO client secrets, webhook signing secrets and integration credentials. Values already
 * sealed with the new key are left alone, so the script can be re-run safely. It stops on the first value that
 * opens with neither key and prints where it is; nothing is overwritten in that case.
 */
import { PrismaClient, withDbContext } from '@dealflow/database';
import { SecretBox } from '../src/common/crypto';

const TENANT_COLUMNS = [
  { table: 'sso_connections', column: 'client_secret_enc' },
  { table: 'webhooks', column: 'secret_encrypted' },
  { table: 'integration_connections', column: 'credentials_encrypted' },
] as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.ENCRYPTION_KEY) throw new Error('Set ENCRYPTION_KEY (the new key).');
  if (!process.env.ENCRYPTION_KEY_PREVIOUS) throw new Error('Set ENCRYPTION_KEY_PREVIOUS (the key being retired).');
  const box = new SecretBox({ ENCRYPTION_KEY: process.env.ENCRYPTION_KEY, ENCRYPTION_KEY_PREVIOUS: process.env.ENCRYPTION_KEY_PREVIOUS, JWT_ACCESS_SECRET: '' });
  const prisma = new PrismaClient();
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
    // users has no tenant column; the runtime role reads it directly.
    const users = await prisma.$queryRaw<{ id: string; v: string }[]>`SELECT id::text, mfa_secret_enc AS v FROM users WHERE mfa_secret_enc IS NOT NULL`;
    for (const u of users) {
      const next = reseal(`users.mfa_secret_enc (${u.id})`, u.v);
      count('users.mfa_secret_enc', !!next);
      if (next && !dryRun) await prisma.$executeRaw`UPDATE users SET mfa_secret_enc = ${next} WHERE id = ${u.id}::uuid AND mfa_secret_enc = ${u.v}`;
    }
    // Tenant tables force row-level security, so each tenant is handled inside its own context.
    const tenants = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.operator_scan', 'on', true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM tenants`;
    });
    for (const t of tenants) {
      await withDbContext(prisma, { tenantId: t.id }, async (tx) => {
        for (const { table, column } of TENANT_COLUMNS) {
          const rows = await tx.$queryRawUnsafe<{ id: string; v: string }[]>(`SELECT id::text, ${column} AS v FROM ${table} WHERE tenant_id = $1::uuid AND ${column} IS NOT NULL`, t.id);
          for (const r of rows) {
            const next = reseal(`${table}.${column} (${r.id})`, r.v);
            count(`${table}.${column}`, !!next);
            if (next && !dryRun) await tx.$executeRawUnsafe(`UPDATE ${table} SET ${column} = $1 WHERE id = $2::uuid AND ${column} = $3`, next, r.id, r.v);
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
