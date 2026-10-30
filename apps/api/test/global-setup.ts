import { PrismaClient } from '@dealflow/database';

const OWNER_URL =
  process.env.TEST_OWNER_DATABASE_URL ??
  'postgresql://dealflow_owner:dealflow_owner_dev@localhost:5432/dealflow_test';

/** Empties every application table (keeping reference data such as plans) before the suite. */
export default async function setup(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE users, sessions, tenants, subscriptions, roles, memberships, teams, team_members,
               audit_logs, companies, contacts, leads, pipelines, pipeline_stages, opportunities,
               activities, tasks, custom_fields, invitations CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}
