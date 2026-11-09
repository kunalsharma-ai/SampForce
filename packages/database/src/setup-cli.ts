import { PrismaClient } from '@prisma/client';
import { setupDatabase } from './setup';

/**
 * `pnpm --filter @dealflow/database db:setup` (the migrate image runs `node dist/setup-cli.js`): creates the
 * collections and indexes the schema declares, drops stale ones and seeds the plan catalogue. Safe to run on every
 * deploy; a second run changes nothing.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await setupDatabase(prisma);
    console.warn('SampForce database set-up complete');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
