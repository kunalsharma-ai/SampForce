import { PrismaClient } from '@prisma/client';
import { setupDatabase } from './setup';

/** `pnpm --filter @dealflow/database db:setup`: run after `prisma db push` on every deploy. */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await setupDatabase(prisma);
    console.log('SampForce database set-up complete');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
