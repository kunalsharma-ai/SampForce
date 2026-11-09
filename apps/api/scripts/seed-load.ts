/**
 * Load-test seed. Creates one clearly labelled demo workspace ("Load Test Workspace") with a large volume
 * of synthetic records, for measuring list and report performance. Refuses to run in production.
 *
 *   LOAD_SCALE=1 DEMO_USER_PASSWORD=... node -r @swc-node/register scripts/seed-load.ts
 *
 * Scale 1 = 5,000 companies, 25,000 contacts, 25,000 leads, 20,000 deals (with stage history) and
 * 100,000 activities. The workspace owner is load-owner@sampforce.local.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, provisionTenant, type TenantTx, withDbContext } from '@dealflow/database';
import { PasswordService } from '../src/auth/password.service';

const EMAIL = 'load-owner@sampforce.local';
const DAY = 86_400_000;
const BATCH = 5000;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed load-test data in production.');
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password) throw new Error('Set DEMO_USER_PASSWORD for the load-test owner.');
  const scale = Math.max(0.01, Number(process.env.LOAD_SCALE ?? '1'));
  const n = (base: number) => Math.round(base * scale);

  const prisma = createPrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email: EMAIL } })) {
      console.warn(`${EMAIL} already exists; nothing to do.`);
      return;
    }
    const tenantId = randomUUID();
    const started = Date.now();
    const { userId, pipelineId, stages } = await withDbContext(prisma, { tenantId }, async (tx) => {
      const user = await tx.user.create({ data: { email: EMAIL, name: 'Load Test Owner', passwordHash: await new PasswordService().hash(password) } });
      const { pipeline } = await provisionTenant(tx, { tenantId, name: 'Load Test Workspace', slug: `load-${tenantId.slice(0, 6)}`, ownerUserId: user.id, isDemo: true, planCode: 'enterprise' });
      await tx.subscription.updateMany({ where: { tenantId }, data: { seats: 50 } });
      const stages = await tx.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { position: 'asc' }, select: { id: true, category: true } });
      return { userId: user.id, pipelineId: pipeline.id, stages };
    });
    const t = tenantId;
    const u = userId;
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * DAY);
    const pick = <T>(xs: readonly T[], g: number): T => xs[g % xs.length]!;
    const COUNTRIES = ['IN', 'US', 'GB', 'DE', 'SG', 'AE'] as const;
    // MongoDB transactions are kept short, so records go in batches, each in its own transaction.
    const insert = async <R>(label: string, rows: R[], write: (tx: TenantTx, batch: R[]) => Promise<unknown>) => {
      for (let i = 0; i < rows.length; i += BATCH) await withDbContext(prisma, { tenantId }, (tx) => write(tx, rows.slice(i, i + BATCH)), { timeoutMs: 120_000 });
      console.warn(`${label}: ${rows.length}`);
    };
    const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

    const companies = range(n(5000)).map((g) => ({
      id: randomUUID(), tenantId: t, name: `Load Company ${g}`, industry: pick(['Retail', 'Healthcare services', 'Logistics', 'Market research', 'Software'], g - 1),
      country: pick(COUNTRIES, g - 1), ownerId: u,
    }));
    await insert('companies', companies, (tx, b) => tx.company.createMany({ data: b }));
    await insert('contacts', range(n(25000)).map((g) => {
      const c = companies[g % companies.length]!;
      return { tenantId: t, companyId: c.id, firstName: 'Contact', lastName: String(g), email: `contact${g}@example.com`, country: c.country, ownerId: u, createdAt: daysAgo(g % 720) };
    }), (tx, b) => tx.contact.createMany({ data: b }));
    await insert('leads', range(n(25000)).map((g) => ({
      tenantId: t, fullName: `Load Lead ${g}`, companyName: `Load Company ${1 + (g % 5000)}`, email: `lead${g}@example.com`, country: pick(COUNTRIES, g),
      source: pick(['Website', 'Referral', 'Event', 'Outbound'], g), status: pick(['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'] as const, g),
      estimatedValue: ((g % 90) + 10) * 1000, currency: 'USD', ownerId: u, createdAt: daysAgo(g % 540),
    })), (tx, b) => tx.lead.createMany({ data: b }));
    const deals = range(n(20000)).map((g) => {
      const s = stages[g % stages.length]!;
      const closed = s.category === 'WON' || s.category === 'LOST';
      const close = daysAgo(60 - (g % 180));
      return {
        id: randomUUID(), tenantId: t, pipelineId, stageId: s.id, name: `Load Deal ${g}`, amount: ((g % 200) + 5) * 500, currency: 'USD',
        status: (s.category === 'WON' ? 'WON' : s.category === 'LOST' ? 'LOST' : 'OPEN') as 'WON' | 'LOST' | 'OPEN',
        expectedCloseDate: new Date(Date.UTC(close.getUTCFullYear(), close.getUTCMonth(), close.getUTCDate())),
        closedAt: closed ? daysAgo(g % 365) : null, ownerId: u, companyId: companies[g % companies.length]!.id, createdAt: daysAgo((g % 400) + 1),
      };
    });
    await insert('deals', deals, (tx, b) => tx.opportunity.createMany({ data: b }));
    await insert('stage history', deals.map((d) => ({ tenantId: t, opportunityId: d.id, pipelineId, fromStageId: null, toStageId: d.stageId, actorUserId: u, occurredAt: d.createdAt })),
      (tx, b) => tx.dealStageEvent.createMany({ data: b }));
    await insert('activities', range(n(100000)).map((g) => ({
      tenantId: t, type: pick(['CALL', 'EMAIL', 'MEETING', 'NOTE'] as const, g), subject: `Load activity ${g}`, occurredAt: daysAgo(g % 365), ownerId: u,
      opportunityId: deals[g % deals.length]!.id,
    })), (tx, b) => tx.activity.createMany({ data: b }));
    console.warn(`Load Test Workspace ${tenantId} seeded at scale ${scale} in ${Math.round((Date.now() - started) / 1000)}s. Owner: ${EMAIL}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
