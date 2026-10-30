/**
 * Development/demo seed. Creates a clearly labelled demo workspace with synthetic records so
 * the Command Center has something to show locally. Refuses to run in production.
 *
 *   pnpm db:seed           (uses DATABASE_URL and DEMO_USER_PASSWORD from .env)
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, provisionTenant, withDbContext } from '@dealflow/database';
import { PasswordService } from '../src/auth/password.service';

const DEMO_EMAIL = 'demo@dealflow.local';
const DAY = 86_400_000;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password) throw new Error('Set DEMO_USER_PASSWORD to seed the demo user.');

  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
      console.warn(`Demo user ${DEMO_EMAIL} already exists; nothing to do.`);
      return;
    }
    const passwordHash = await new PasswordService().hash(password);
    const tenantId = randomUUID();
    const now = Date.now();

    await withDbContext(prisma, { tenantId }, async (tx) => {
      const user = await tx.user.create({ data: { email: DEMO_EMAIL, name: 'Demo User', passwordHash } });
      const { pipeline } = await provisionTenant(tx, {
        tenantId,
        name: 'DealFlow Demo Workspace',
        slug: `demo-${tenantId.slice(0, 6)}`,
        ownerUserId: user.id,
        isDemo: true,
      });
      const stages = await tx.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { position: 'asc' } });
      const stage = (i: number) => stages[i]!.id;

      const companies = await Promise.all(
        ['Demo Analytics GmbH', 'Sample Retail Ltd', 'Example Health Services', 'Placeholder Logistics Pvt Ltd'].map(
          (name, i) =>
            tx.company.create({ data: { tenantId, name, country: ['DE', 'GB', 'US', 'IN'][i], industry: ['Market research', 'Retail', 'Healthcare services', 'Logistics'][i] } }),
        ),
      );

      const leadStatuses = ['NEW', 'NEW', 'CONTACTED', 'QUALIFIED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'NEW'] as const;
      await tx.lead.createMany({
        data: leadStatuses.map((status, i) => ({
          tenantId,
          fullName: `Demo Lead ${i + 1}`,
          companyName: companies[i % companies.length]!.name,
          email: `lead${i + 1}@example.com`,
          country: ['DE', 'GB', 'US', 'IN'][i % 4],
          source: ['Web form', 'Referral', 'CSV import', 'Event'][i % 4],
          status,
          estimatedValue: 5_000 + i * 2_500,
          currency: 'USD',
          ownerId: user.id,
          tags: ['demo'],
          createdAt: new Date(now - i * 4 * DAY),
          convertedAt: status === 'CONVERTED' ? new Date(now - DAY) : null,
        })),
      });

      const deals: [string, number, number, 'OPEN' | 'WON' | 'LOST', number][] = [
        ['Annual research panel', 24_000, 2, 'OPEN', 20],
        ['Brand tracker pilot', 12_500, 1, 'OPEN', 35],
        ['Patient survey programme', 38_000, 3, 'OPEN', 15],
        ['Retail audit wave 1', 9_000, 0, 'OPEN', 50],
        ['Logistics NPS study', 16_000, 4, 'WON', 10],
        ['Concept test bundle', 7_500, 4, 'WON', 3],
        ['Usage & attitudes study', 21_000, 5, 'LOST', 6],
      ];
      for (const [i, [name, amount, stageIdx, status, daysAgo]] of deals.entries()) {
        await tx.opportunity.create({
          data: {
            tenantId,
            pipelineId: pipeline.id,
            stageId: stage(stageIdx),
            name: `${name} (demo)`,
            amount,
            currency: 'USD',
            status,
            ownerId: user.id,
            companyId: companies[i % companies.length]!.id,
            expectedCloseDate: new Date(now + (30 - daysAgo) * DAY),
            createdAt: new Date(now - (daysAgo + 30) * DAY),
            closedAt: status === 'OPEN' ? null : new Date(now - daysAgo * DAY),
            lossReason: status === 'LOST' ? 'Budget moved to next fiscal year' : null,
          },
        });
      }

      await tx.activity.createMany({
        data: ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'EMAIL'].map((type, i) => ({
          tenantId,
          type: type as 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE',
          subject: `Demo ${type.toLowerCase()} ${i + 1}`,
          ownerId: user.id,
          occurredAt: new Date(now - i * 2 * DAY),
        })),
      });

      await tx.auditLog.create({
        data: { tenantId, actorType: 'SYSTEM', action: 'tenant.created', entityType: 'tenant', entityId: tenantId, metadata: { seed: 'demo' } },
      });
    });
    console.warn(`Seeded demo workspace. Sign in as ${DEMO_EMAIL} with DEMO_USER_PASSWORD.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
