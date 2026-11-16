/**
 * Replaces the session signing secrets stored in the database (ADR 0059) with new random values.
 *
 *   node dist/cli/rotate-signing-secrets.js [JWT_ACCESS_SECRET] [OPERATOR_JWT_SECRET]   (no names: both)
 *
 * Then restart the API and the worker. Self-host: deploy/scripts/rotate-signing-secrets.sh does both steps.
 */
import { rotateSigningSecrets, SIGNING_SECRET_NAMES, type SigningSecretName } from '../common/server-secrets';

async function main(argv: string[]): Promise<void> {
  const unknown = argv.filter((a) => !(SIGNING_SECRET_NAMES as readonly string[]).includes(a));
  if (unknown.length) throw new Error(`usage: rotate-signing-secrets [${SIGNING_SECRET_NAMES.join('] [')}]`);
  const names = (argv.length ? argv : SIGNING_SECRET_NAMES) as SigningSecretName[];
  await rotateSigningSecrets(names);
  console.warn(`New ${names.join(' and ')} saved. Restart the API and the worker for them to take effect.`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
