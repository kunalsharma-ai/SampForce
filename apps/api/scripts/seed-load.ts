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
import { PrismaClient, provisionTenant, withDbContext } from '@dealflow/database';
import { PasswordService } from '../src/auth/password.service';

const EMAIL = 'load-owner@sampforce.local';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed load-test data in production.');
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password) throw new Error('Set DEMO_USER_PASSWORD for the load-test owner.');
  const scale = Math.max(0.01, Number(process.env.LOAD_SCALE ?? '1'));
  const n = (base: number) => Math.round(base * scale);

  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email: EMAIL } })) {
      console.warn(`${EMAIL} already exists; nothing to do.`);
      return;
    }
    const tenantId = randomUUID();
    const started = Date.now();
    await withDbContext(prisma, { tenantId }, async (tx) => {
      const user = await tx.user.create({ data: { email: EMAIL, name: 'Load Test Owner', passwordHash: await new PasswordService().hash(password) } });
      const { pipeline } = await provisionTenant(tx, { tenantId, name: 'Load Test Workspace', slug: `load-${tenantId.slice(0, 6)}`, ownerUserId: user.id, isDemo: true, planCode: 'enterprise' });
      await tx.subscription.updateMany({ where: { tenantId }, data: { seats: 50 } });
      const t = tenantId;
      const p = pipeline.id;
      const u = user.id;

      await tx.$executeRaw`INSERT INTO companies (id, tenant_id, name, industry, country, owner_id, updated_at)
        SELECT gen_random_uuid(), ${t}::uuid, 'Load Company ' || g, (ARRAY['Retail','Healthcare services','Logistics','Market research','Software'])[1 + g % 5],
               (ARRAY['IN','US','GB','DE','SG','AE'])[1 + g % 6], ${u}::uuid, now()
        FROM generate_series(1, ${n(5000)}::int) g`;
      await tx.$executeRaw`INSERT INTO contacts (id, tenant_id, company_id, first_name, last_name, email, country, owner_id, created_at, updated_at)
        SELECT gen_random_uuid(), ${t}::uuid, c.id, 'Contact' , g::text, 'contact' || g || '@example.com', c.country, ${u}::uuid,
               now() - (g % 720) * interval '1 day', now()
        FROM generate_series(1, ${n(25000)}::int) g
        JOIN (SELECT id, country, row_number() OVER (ORDER BY id) - 1 AS rn FROM companies WHERE tenant_id = ${t}::uuid) c ON c.rn = g % ${n(5000)}::int`;
      await tx.$executeRaw`INSERT INTO leads (id, tenant_id, full_name, company_name, email, country, source, status, estimated_value, currency, owner_id, created_at, updated_at)
        SELECT gen_random_uuid(), ${t}::uuid, 'Load Lead ' || g, 'Load Company ' || (1 + g % 5000), 'lead' || g || '@example.com',
               (ARRAY['IN','US','GB','DE','SG','AE'])[1 + g % 6], (ARRAY['Website','Referral','Event','Outbound'])[1 + g % 4],
               (ARRAY['NEW','CONTACTED','QUALIFIED','UNQUALIFIED'])[1 + g % 4]::"LeadStatus", (g % 90 + 10) * 1000, 'USD', ${u}::uuid,
               now() - (g % 540) * interval '1 day', now()
        FROM generate_series(1, ${n(25000)}::int) g`;
      await tx.$executeRaw`INSERT INTO opportunities (id, tenant_id, pipeline_id, stage_id, name, amount, currency, status, expected_close_date, closed_at, owner_id, company_id, created_at, updated_at)
        SELECT gen_random_uuid(), ${t}::uuid, ${p}::uuid, s.id, 'Load Deal ' || g, (g % 200 + 5) * 500, 'USD',
               CASE s.category WHEN 'WON' THEN 'WON'::"OpportunityStatus" WHEN 'LOST' THEN 'LOST'::"OpportunityStatus" ELSE 'OPEN'::"OpportunityStatus" END,
               (now() + ((g % 180) - 60) * interval '1 day')::date,
               CASE WHEN s.category IN ('WON','LOST') THEN now() - (g % 365) * interval '1 day' END,
               ${u}::uuid, c.id, now() - (g % 400 + 1) * interval '1 day', now()
        FROM generate_series(1, ${n(20000)}::int) g
        JOIN (SELECT id, category, row_number() OVER (ORDER BY position) - 1 AS rn, count(*) OVER () AS total FROM pipeline_stages WHERE pipeline_id = ${p}::uuid) s ON s.rn = g % s.total
        JOIN (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn FROM companies WHERE tenant_id = ${t}::uuid) c ON c.rn = g % ${n(5000)}::int`;
      await tx.$executeRaw`INSERT INTO deal_stage_events (id, tenant_id, opportunity_id, pipeline_id, from_stage_id, to_stage_id, actor_user_id, occurred_at)
        SELECT gen_random_uuid(), o.tenant_id, o.id, o.pipeline_id, NULL, o.stage_id, ${u}::uuid, o.created_at FROM opportunities o WHERE o.tenant_id = ${t}::uuid`;
      await tx.$executeRaw`INSERT INTO activities (id, tenant_id, type, subject, occurred_at, owner_id, opportunity_id, updated_at)
        SELECT gen_random_uuid(), ${t}::uuid, (ARRAY['CALL','EMAIL','MEETING','NOTE'])[1 + g % 4]::"ActivityType", 'Load activity ' || g,
               now() - (g % 365) * interval '1 day', ${u}::uuid, o.id, now()
        FROM generate_series(1, ${n(100000)}::int) g
        JOIN (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn FROM opportunities WHERE tenant_id = ${t}::uuid) o ON o.rn = g % ${n(20000)}::int`;
    }, { timeoutMs: 30 * 60_000 });
    console.warn(`Load Test Workspace ${tenantId} seeded at scale ${scale} in ${Math.round((Date.now() - started) / 1000)}s. Owner: ${EMAIL}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
