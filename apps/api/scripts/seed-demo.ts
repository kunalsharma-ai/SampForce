/**
 * Development/demo seed. Creates a clearly labelled demo workspace with synthetic records so
 * the Command Center has something to show locally. Refuses to run in production.
 *
 *   pnpm db:seed           (uses DATABASE_URL and DEMO_USER_PASSWORD from .env)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient, provisionTenant, type TenantTx, withDbContext } from '@dealflow/database';
import { quarterPeriod } from '@dealflow/types';
import { PasswordService } from '../src/auth/password.service';

const DEMO_EMAIL = 'demo@sampforce.local';
const DAY = 86_400_000;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password) throw new Error('Set DEMO_USER_PASSWORD to seed the demo user.');

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
    if (existing) {
      // Older demo workspaces get the Phase 5 sample records added once.
      const memberships = await withDbContext(prisma, { userId: existing.id }, (tx) => tx.membership.findMany({ where: { userId: existing.id }, select: { tenantId: true } }));
      let added = false;
      for (const m of memberships) added = (await withDbContext(prisma, { tenantId: m.tenantId, userId: existing.id }, (tx) => seedRevenue(tx, m.tenantId, existing.id))) || added;
      console.warn(added ? 'Added sample quotes, contracts, campaigns and customer data to the demo workspace.' : `Demo user ${DEMO_EMAIL} already exists; nothing to do.`);
      return;
    }
    const passwordHash = await new PasswordService().hash(password);
    const tenantId = randomUUID();
    const now = Date.now();

    await withDbContext(prisma, { tenantId }, async (tx) => {
      const user = await tx.user.create({ data: { email: DEMO_EMAIL, name: 'Demo User', passwordHash } });
      const { pipeline } = await provisionTenant(tx, {
        tenantId,
        name: 'SampForce Demo Workspace',
        slug: `demo-${tenantId.slice(0, 6)}`,
        ownerUserId: user.id,
        isDemo: true,
      });
      // The demo shows every module, so it runs on the top plan (plan features, ADR 0057). Nothing is billed.
      await tx.subscription.update({ where: { tenantId }, data: { planCode: 'enterprise_plus', seats: 10, status: 'ACTIVE' } });
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
        const deal = await tx.opportunity.create({
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
        // Demo stage history: the deal walks through the open stages, evenly spaced, to where it stands today.
        // Lost deals leave from stage 2.
        const path = status === 'LOST' ? [0, 1, 2, stageIdx] : status === 'WON' ? [0, 1, 2, 3, stageIdx] : Array.from({ length: stageIdx + 1 }, (_, k) => k);
        const start = now - (daysAgo + 30) * DAY;
        const end = status === 'OPEN' ? now - Math.min(daysAgo, 5) * DAY : now - daysAgo * DAY;
        for (const [k, idx] of path.entries()) {
          await tx.dealStageEvent.create({
            data: {
              tenantId, opportunityId: deal.id, pipelineId: pipeline.id, fromStageId: k === 0 ? null : stage(path[k - 1]!),
              toStageId: stage(idx), actorUserId: user.id, occurredAt: new Date(path.length === 1 ? start : start + ((end - start) * k) / (path.length - 1)),
            },
          });
        }
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

      await seedRevenue(tx, tenantId, user.id);

      await tx.auditLog.create({
        data: { tenantId, actorType: 'SYSTEM', action: 'tenant.created', entityType: 'tenant', entityId: tenantId, metadata: { seed: 'demo' } },
      });
    });
    console.warn(`Seeded demo workspace. Sign in as ${DEMO_EMAIL} with DEMO_USER_PASSWORD.`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Phase 5 sample records for the demo workspace only: a catalogue, a quote, contracts, a campaign with a
 * hosted form, a target and an escalation. Every name is marked "(demo)". Returns false if already present.
 */
async function seedRevenue(tx: TenantTx, tenantId: string, userId: string): Promise<boolean> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.isDemo || (await tx.product.count({ where: { tenantId } })) > 0) return false;
  const now = Date.now();
  const day = (offset: number) => new Date(new Date(now + offset * DAY).toISOString().slice(0, 10));
  const products = await Promise.all(
    [
      ['Survey programme (demo)', 'DEMO-SURV', 'study', 9000],
      ['Panel access, per month (demo)', 'DEMO-PANEL', 'month', 1500],
      ['Analysis workshop (demo)', 'DEMO-WS', 'day', 1200],
    ].map(async ([name, sku, unit, price]) => ({ product: await tx.product.create({ data: { tenantId, name: String(name), sku: String(sku), unit: String(unit) } }), price: Number(price) })),
  );
  const book = await tx.priceBook.create({ data: { tenantId, name: 'Demo list prices', currency: 'USD', isDefault: true } });
  await tx.priceBookEntry.createMany({ data: products.map((p) => ({ tenantId, priceBookId: book.id, productId: p.product.id, unitPrice: p.price })) });
  const tax = await tx.taxRate.create({ data: { tenantId, name: 'Sample tax 10% (demo)', rate: 10 } });

  const won = await tx.opportunity.findFirst({ where: { tenantId, status: 'WON' }, orderBy: { closedAt: 'desc' } });
  if (won) {
    // 1 study at 9,000 with 5% off, plus 2 workshop days: net 8,550 + 2,400 = 10,950; tax 1,095.
    await tx.quote.create({
      data: {
        tenantId, number: 1, opportunityId: won.id, priceBookId: book.id, title: `Quote for ${won.name}`, currency: 'USD', status: 'ACCEPTED', validUntil: day(20),
        subtotal: 11400, discountTotal: 450, taxTotal: 1095, total: 12045, maxDiscountPercent: 5, createdById: userId, sentAt: day(-12), decidedAt: day(-10),
        lines: {
          create: [
            { tenantId, productId: products[0]!.product.id, position: 0, name: products[0]!.product.name, quantity: 1, unitPrice: 9000, discountPercent: 5, taxRateId: tax.id, taxPercent: 10, netTotal: 8550, taxTotal: 855 },
            { tenantId, productId: products[2]!.product.id, position: 1, name: products[2]!.product.name, quantity: 2, unitPrice: 1200, discountPercent: 0, taxRateId: tax.id, taxPercent: 10, netTotal: 2400, taxTotal: 240 },
          ],
        },
      },
    });
  }
  const companies = await tx.company.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, take: 2 });
  if (companies[0]) {
    const c = await tx.contract.create({
      data: { tenantId, number: 1, name: 'Annual panel agreement (demo)', companyId: companies[0].id, opportunityId: won?.id ?? null, ownerId: userId, status: 'ACTIVE', value: 18000, currency: 'USD', startDate: day(-340), endDate: day(25), renewalNoticeDays: 45, signatureMethod: 'wet_ink', signedBy: 'Demo signatory', signedAt: day(-340) },
    });
    await tx.escalation.create({ data: { tenantId, companyId: companies[0].id, contractId: c.id, title: 'Late fieldwork report (demo)', severity: 'MEDIUM', ownerId: userId, openedById: userId } });
  }
  if (companies[1]) {
    await tx.contract.create({
      data: { tenantId, number: 2, name: 'Tracker subscription (demo)', companyId: companies[1].id, ownerId: userId, status: 'ACTIVE', value: 9000, currency: 'USD', startDate: day(-60), endDate: day(305), autoRenew: true, signatureMethod: 'email_confirmation', signedBy: 'Demo signatory', signedAt: day(-60) },
    });
  }
  const campaign = await tx.campaign.create({ data: { tenantId, name: 'Autumn webinar (demo)', channel: 'webinar', status: 'ACTIVE', startDate: day(-20), endDate: day(10), budget: 2000, currency: 'USD', utmCampaign: 'demo-autumn', ownerId: userId } });
  await tx.leadForm.create({
    data: {
      tenantId, name: 'Webinar sign-up (demo)', publicToken: randomBytes(18).toString('base64url'), title: 'Join the demo webinar', ownerId: userId, campaignId: campaign.id,
      fields: [{ key: 'fullName', label: 'Full name', required: true }, { key: 'email', label: 'Work email', required: true }, { key: 'companyName', label: 'Company', required: false }],
      consentText: 'I would like to receive product news by email. I can unsubscribe at any time.', successMessage: 'Thank you. This is a demo form.',
    },
  });
  await tx.lead.updateMany({ where: { tenantId, tags: { has: 'demo' } }, data: { campaignSource: 'demo-autumn' } });
  await tx.salesTarget.create({ data: { tenantId, userId: null, period: quarterPeriod(undefined).label, amount: 60000 } });
  return true;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
