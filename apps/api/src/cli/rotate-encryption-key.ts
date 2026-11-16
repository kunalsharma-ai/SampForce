/**
 * Rotates the ENCRYPTION_KEY stored in the database (ADR 0059) without making any stored secret unreadable.
 *
 *   node dist/cli/rotate-encryption-key.js start    # new key, old one kept as previous, every secret re-sealed
 *   (restart the API and the worker)
 *   node dist/cli/rotate-encryption-key.js finish   # re-seal anything sealed in between, forget the old key
 *
 * Self-host: deploy/scripts/rotate-encryption-key.sh runs all three steps.
 */
import { rotateEncryptionKey } from '../common/server-secrets';

async function main(step: string | undefined): Promise<void> {
  if (step !== 'start' && step !== 'finish')
    throw new Error('usage: rotate-encryption-key start|finish');
  const counts = await rotateEncryptionKey(step);
  for (const [k, c] of Object.entries(counts))
    console.warn(`${k}: ${c.checked} checked, ${c.resealed} re-sealed`);
  console.warn(
    step === 'start'
      ? 'New ENCRYPTION_KEY stored. Restart the API and the worker, then run the finish step.'
      : 'Rotation finished: the old key is no longer kept.',
  );
}

main(process.argv[2]).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
