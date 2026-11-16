/**
 * Re-seals every stored secret with the current ENCRYPTION_KEY after a key rotation.
 *
 *   ENCRYPTION_KEY=<new> ENCRYPTION_KEY_PREVIOUS=<old> DATABASE_URL=<mongodb url> \
 *     node -r @swc-node/register scripts/reseal-secrets.ts [--dry-run] [--only=platform_secrets,webhooks]
 *   (production image: node dist/cli/reseal-secrets.js with the same flags)
 *
 * Covers TOTP secrets, provider keys saved in the operator console, the session signing secrets (ADR 0059), SSO client secrets, webhook signing secrets and
 * integration and workspace app credentials. Values already
 * sealed with the new key are left alone, so the script can be re-run safely. It stops on the first value that
 * opens with neither key and prints where it is; nothing is overwritten in that case.
 */
import { createPrismaClient } from '@dealflow/database';
import { SecretBox } from '../common/crypto';
import { resealAll } from '../common/reseal';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // --only=<table>[,<table>] re-seals just those tables (for example after a partial run).
  const only =
    process.argv
      .find((a) => a.startsWith('--only='))
      ?.slice('--only='.length)
      .split(',')
      .filter(Boolean) ?? null;
  if (!process.env.ENCRYPTION_KEY) throw new Error('Set ENCRYPTION_KEY (the new key).');
  if (!process.env.ENCRYPTION_KEY_PREVIOUS)
    throw new Error('Set ENCRYPTION_KEY_PREVIOUS (the key being retired).');
  const box = new SecretBox({
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ENCRYPTION_KEY_PREVIOUS: process.env.ENCRYPTION_KEY_PREVIOUS,
    JWT_ACCESS_SECRET: '',
  });
  const prisma = createPrismaClient();
  try {
    const { counts, tenants } = await resealAll(box, prisma, { dryRun, only });
    console.warn(`${dryRun ? 'Dry run, nothing written. ' : ''}${tenants} workspaces checked.`);
    for (const [k, c] of Object.entries(counts))
      console.warn(`${k}: ${c.checked} checked, ${c.resealed} re-sealed`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
