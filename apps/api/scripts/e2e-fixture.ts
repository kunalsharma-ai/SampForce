/**
 * Test data for the browser end-to-end suite (apps/web/e2e/helpers.ts), written as the app would write it: through
 * the guarded client, inside the workspace's own context. Refuses to run in production.
 *
 *   DATABASE_URL=... node -r @swc-node/register scripts/e2e-fixture.ts '<json>'
 *
 * where <json> is one of
 *   { "action": "setPlan", "tenantId": "...", "planCode": "pro" }
 *   { "action": "inboundEmail", "tenantId": "...", "userId": "...", "from": "...", "subject": "...", "body": "...", "contactId"?: "..." }
 *   { "action": "meeting", "tenantId": "...", "userId": "...", "title": "...", "hoursFromNow": 2, "contactId": "...", "attendee": "...", "joinUrl"?: "..." }
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, type TenantTx, withDbContext } from '@dealflow/database';
import { storeEmail } from '../src/integrations/threading';

type Fixture =
  | { action: 'setPlan'; tenantId: string; planCode: string }
  | { action: 'inboundEmail'; tenantId: string; userId: string; from: string; subject: string; body: string; contactId?: string }
  | { action: 'meeting'; tenantId: string; userId: string; title: string; hoursFromNow: number; contactId: string; attendee: string; joinUrl?: string };

const MAILBOX = 'me@seller.test';

/** The test mailbox connection (Google), created on first use. */
async function mailbox(tx: TenantTx, tenantId: string, userId: string): Promise<string> {
  const c = await tx.integrationConnection.upsert({
    where: { tenantId_userId_provider: { tenantId, userId, provider: 'GOOGLE' } },
    create: { tenantId, userId, provider: 'GOOGLE', accountEmail: MAILBOX, scopes: [], credentialsEncrypted: 'v1.x.y.z' },
    update: {},
    select: { id: true },
  });
  return c.id;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to write test fixtures in production.');
  const f = JSON.parse(process.argv[2] ?? '{}') as Fixture;
  const prisma = createPrismaClient();
  try {
    if (f.action === 'setPlan') {
      await withDbContext(prisma, { tenantId: f.tenantId }, (tx) =>
        tx.subscription.updateMany({ where: { tenantId: f.tenantId }, data: { planCode: f.planCode.replace(/[^a-z_]/g, ''), seats: 10, status: 'ACTIVE' } }),
      );
    } else if (f.action === 'inboundEmail') {
      await withDbContext(prisma, { tenantId: f.tenantId, userId: f.userId }, async (tx) => {
        const connectionId = await mailbox(tx, f.tenantId, f.userId);
        await storeEmail(tx, {
          tenantId: f.tenantId, connectionId, providerMessageId: randomUUID(), direction: 'INBOUND', fromAddress: f.from, toAddresses: [MAILBOX], ccAddresses: [],
          subject: f.subject, snippet: f.body.slice(0, 80), bodyText: f.body, sentAt: new Date(), contactId: f.contactId ?? null,
        });
      });
    } else if (f.action === 'meeting') {
      await withDbContext(prisma, { tenantId: f.tenantId, userId: f.userId }, async (tx) => {
        const connectionId = await mailbox(tx, f.tenantId, f.userId);
        const startsAt = new Date(Date.now() + f.hoursFromNow * 3_600_000);
        await tx.meeting.create({
          data: {
            tenantId: f.tenantId, connectionId, providerEventId: randomUUID(), title: f.title, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000),
            attendees: [f.attendee, MAILBOX], contactIds: [f.contactId], joinUrl: f.joinUrl ?? null,
          },
        });
      });
    } else {
      throw new Error(`Unknown fixture ${(f as { action?: string }).action}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
