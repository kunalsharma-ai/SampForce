import { PrismaClient, setupDatabase } from '@dealflow/database';

const URL = process.env.TEST_DATABASE_URL ?? 'mongodb://localhost:27017/sampforce_test?replicaSet=rs0';

/** Starts the suite on an empty database with every index and the plan catalogue in place. */
export default async function setup(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    await prisma.$runCommandRaw({ dropDatabase: 1 });
    await setupDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
