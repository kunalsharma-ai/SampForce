import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { nullsLast, type PrismaClient, withDbContext, withDbScope } from '@dealflow/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appClient, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/**
 * The workspace guard (packages/database/src/scope.ts, ADR 0058) in place of PostgreSQL row-level security: every
 * query through the app's client is held to the current workspace, with narrow, named exceptions. Also covers the
 * MongoDB behaviours the client evens out (nulls, regex escaping, enum order, partial unique indexes, money scale).
 */
describe('workspace guard', () => {
  let app: INestApplication;
  let a: TestUser & { userId: string };
  let b: TestUser & { userId: string };
  let db: PrismaClient;
  let raw: PrismaClient;

  const as = <T>(u: { tenantId: string; userId?: string }, fn: Parameters<typeof withDbContext<T>>[2]) => withDbContext(db, { tenantId: u.tenantId, userId: u.userId }, fn);

  beforeAll(async () => {
    app = await startApp();
    db = appClient();
    raw = ownerClient();
    const withUser = async (u: TestUser) => ({ ...u, userId: (await raw.membership.findFirstOrThrow({ where: { tenantId: u.tenantId } })).userId });
    a = await withUser(await registerUser(app, 'Guard A'));
    b = await withUser(await registerUser(app, 'Guard B'));
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    await raw.$disconnect();
  });

  it('shows nothing and writes nothing without a workspace', async () => {
    await as(a, (tx) => tx.company.create({ data: { tenantId: a.tenantId, name: 'Only A' } }));
    expect(await withDbScope({}, () => db.company.count())).toBe(0);
    expect(await withDbContext(db, {}, (tx) => tx.company.findMany())).toEqual([]);
    await expect(withDbContext(db, {}, (tx) => tx.company.create({ data: { tenantId: a.tenantId, name: 'No context' } }))).rejects.toThrow(/needs a workspace/);
  });

  it('keeps reads, updates and deletes inside the workspace', async () => {
    const c = await as(a, (tx) => tx.company.create({ data: { tenantId: a.tenantId, name: 'Private Co' } }));
    expect(await as(b, (tx) => tx.company.findUnique({ where: { id: c.id } }))).toBeNull();
    expect(await as(b, (tx) => tx.company.findFirst({ where: { name: 'Private Co' } }))).toBeNull();
    expect((await as(b, (tx) => tx.company.updateMany({ where: { id: c.id }, data: { name: 'Hijacked' } }))).count).toBe(0);
    await expect(as(b, (tx) => tx.company.update({ where: { id: c.id }, data: { name: 'Hijacked' } }))).rejects.toThrow();
    expect((await as(b, (tx) => tx.company.deleteMany({ where: { id: c.id } }))).count).toBe(0);
    expect((await raw.company.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Private Co');
    expect(await as(b, (tx) => tx.company.aggregateRaw({ pipeline: [{ $match: { name: 'Private Co' } }] }))).toEqual([]);
  });

  it('refuses to write another workspace id, directly, nested or by moving a record', async () => {
    await expect(as(b, (tx) => tx.company.create({ data: { tenantId: a.tenantId, name: 'Planted' } }))).rejects.toThrow(/outside the current workspace/);
    await expect(
      as(b, (tx) => tx.company.create({ data: { tenantId: b.tenantId, name: 'Parent', contacts: { create: [{ tenantId: a.tenantId, firstName: 'Planted' }] } } })),
    ).rejects.toThrow(/outside the current workspace/);
    const mine = await as(b, (tx) => tx.company.create({ data: { tenantId: b.tenantId, name: 'Mine' } }));
    await expect(as(b, (tx) => tx.company.update({ where: { id: mine.id }, data: { tenantId: a.tenantId } }))).rejects.toThrow(/outside the current workspace/);
    expect(await raw.company.count({ where: { tenantId: a.tenantId, name: { in: ['Planted', 'Parent', 'Mine'] } } })).toBe(0);
    expect(await raw.contact.count({ where: { firstName: 'Planted' } })).toBe(0);
  });

  it('filters included lists to the workspace even when a foreign record points in', async () => {
    const c = await as(a, (tx) => tx.company.create({ data: { tenantId: a.tenantId, name: 'With people' } }));
    await as(a, (tx) => tx.contact.create({ data: { tenantId: a.tenantId, companyId: c.id, firstName: 'Ours' } }));
    // Written around the guard, as a bug or a bad import might: a contact of B pointing at A's company.
    await raw.contact.create({ data: { tenantId: b.tenantId, companyId: c.id, firstName: 'Stray', lastName: null, email: null } });
    const got = await as(a, (tx) => tx.company.findUniqueOrThrow({ where: { id: c.id }, include: { contacts: true } }));
    expect(got.contacts.map((x) => x.firstName)).toEqual(['Ours']);
  });

  it('lets a public page find only the record its token names', async () => {
    const form = await as(a, (tx) =>
      tx.leadForm.create({ data: { tenantId: a.tenantId, name: 'F', publicToken: `tok-${randomUUID()}`, title: 'T', fields: [], successMessage: 'ok', ownerId: a.userId } }),
    );
    const other = await as(a, (tx) =>
      tx.leadForm.create({ data: { tenantId: a.tenantId, name: 'G', publicToken: `tok-${randomUUID()}`, title: 'T', fields: [], successMessage: 'ok', ownerId: a.userId } }),
    );
    const seen = await withDbScope({ lookup: { LeadForm: { publicToken: form.publicToken } } }, () => db.leadForm.findMany({ select: { id: true } }));
    expect(seen.map((f) => f.id)).toEqual([form.id]);
    expect(await withDbScope({ lookup: { LeadForm: { publicToken: 'wrong' } } }, () => db.leadForm.count())).toBe(0);
    expect(await withDbScope({ lookup: { LeadForm: { publicToken: form.publicToken } } }, () => db.leadForm.count({ where: { id: other.id } }))).toBe(0);
    // The lookup opens nothing else.
    expect(await withDbScope({ lookup: { LeadForm: { publicToken: form.publicToken } } }, () => db.company.count())).toBe(0);
  });

  it('opens queue collections, and only those, to the worker scan; and tenants, read-only, to the operator scan', async () => {
    await as(a, (tx) => tx.domainEvent.create({ data: { tenantId: a.tenantId, type: 'guard.test', payload: {} } }));
    await as(b, (tx) => tx.domainEvent.create({ data: { tenantId: b.tenantId, type: 'guard.test', payload: {} } }));
    const tenants = await withDbScope({ workerScan: true }, () => db.domainEvent.findMany({ where: { type: 'guard.test' }, distinct: ['tenantId'], select: { tenantId: true } }));
    expect(tenants.map((t) => t.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());
    expect(await withDbScope({ workerScan: true }, () => db.company.count())).toBe(0);
    expect(await withDbScope({ operatorScan: true }, () => db.tenant.count({ where: { id: { in: [a.tenantId, b.tenantId] } } }))).toBe(2);
    expect(await withDbScope({ operatorScan: true }, () => db.lead.count())).toBe(0);
    // The operator scan reads; a write in it matches nothing.
    expect((await withDbScope({ operatorScan: true }, () => db.tenant.updateMany({ where: { id: a.tenantId }, data: { name: 'Renamed' } }))).count).toBe(0);
    expect((await raw.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).name).not.toBe('Renamed');
  });

  it('keeps personal records personal: a private saved view is its owner’s alone', async () => {
    const other = (await raw.membership.findMany({ where: { tenantId: a.tenantId }, select: { userId: true } })).map((m) => m.userId);
    expect(other).toContain(a.userId);
    const colleague = await raw.user.create({ data: { email: `c-${randomUUID().slice(0, 8)}@example.com`, name: 'Colleague', passwordHash: 'x' } });
    const mine = { tenantId: a.tenantId, userId: a.userId };
    const theirs = { tenantId: a.tenantId, userId: colleague.id };
    await as(mine, (tx) => tx.savedView.create({ data: { tenantId: a.tenantId, userId: a.userId, entity: 'leads', name: 'Private', config: {} } }));
    await as(mine, (tx) => tx.savedView.create({ data: { tenantId: a.tenantId, userId: a.userId, entity: 'leads', name: 'Team', shared: true, config: {} } }));
    expect((await as(theirs, (tx) => tx.savedView.findMany({ where: { entity: 'leads' } }))).map((v) => v.name)).toEqual(['Team']);
    expect((await as(theirs, (tx) => tx.savedView.updateMany({ where: { name: 'Team' }, data: { name: 'Taken' } }))).count).toBe(0);
    await expect(as(theirs, (tx) => tx.savedView.create({ data: { tenantId: a.tenantId, userId: a.userId, entity: 'leads', name: 'Forged', config: {} } }))).rejects.toThrow();
  });

  it('keeps logs append-only', async () => {
    await expect(as(a, (tx) => tx.auditLog.updateMany({ data: { action: 'x' } }))).rejects.toThrow(/append-only/);
    await expect(as(a, (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow(/cannot be deleted/);
    await expect(as(a, (tx) => tx.tenant.delete({ where: { id: a.tenantId } }))).rejects.toThrow(/cannot be deleted/);
  });

  it('matches text filters literally, never as patterns', async () => {
    await as(a, (tx) => tx.company.createMany({ data: [{ tenantId: a.tenantId, name: 'Dot.Com Ltd' }, { tenantId: a.tenantId, name: 'DotXCom Ltd' }] }));
    expect((await as(a, (tx) => tx.company.findMany({ where: { name: { contains: 'dot.com', mode: 'insensitive' } } }))).map((c) => c.name)).toEqual(['Dot.Com Ltd']);
    expect(await as(a, (tx) => tx.company.count({ where: { name: { contains: '.*' } } }))).toBe(0);
    expect(await as(a, (tx) => tx.company.count({ where: { name: { equals: 'dot.com ltd', mode: 'insensitive' } } }))).toBe(1);
    expect(await as(a, (tx) => tx.company.count({ where: { name: { startsWith: '(' } } }))).toBe(0);
  });

  it('stores omitted optional fields as null, so null filters and partial unique indexes behave as before', async () => {
    const c = await as(a, (tx) => tx.company.create({ data: { tenantId: a.tenantId, name: 'No domain' } }));
    expect(await as(a, (tx) => tx.company.count({ where: { id: c.id, domain: null } }))).toBe(1);
    // Two products without a SKU are fine; a repeated SKU is not (partial unique index).
    await as(a, (tx) => tx.product.createMany({ data: [{ tenantId: a.tenantId, name: 'P1' }, { tenantId: a.tenantId, name: 'P2' }] }));
    await as(a, (tx) => tx.product.create({ data: { tenantId: a.tenantId, name: 'P3', sku: 'SKU-1' } }));
    await expect(as(a, (tx) => tx.product.create({ data: { tenantId: a.tenantId, name: 'P4', sku: 'SKU-1' } }))).rejects.toThrow();
    // Another workspace may use the same SKU.
    await as(b, (tx) => tx.product.create({ data: { tenantId: b.tenantId, name: 'P3', sku: 'SKU-1' } }));
    expect((await as(a, (tx) => tx.product.createMany({ data: [] }))).count).toBe(0);
  });

  it('sorts nulls last on request, enums in declared order, and keeps money at its old scale', async () => {
    const now = Date.now();
    await as(a, (tx) =>
      tx.task.createMany({
        data: [
          { tenantId: a.tenantId, title: 'Undated' },
          { tenantId: a.tenantId, title: 'Later', dueAt: new Date(now + 2 * 86_400_000) },
          { tenantId: a.tenantId, title: 'Sooner', dueAt: new Date(now + 86_400_000) },
        ],
      }),
    );
    const tasks = await as(a, (tx) => tx.task.findMany({ where: { title: { in: ['Undated', 'Later', 'Sooner'] } }, orderBy: [{ dueAt: nullsLast('asc') }] }));
    expect(tasks.map((t) => t.title)).toEqual(['Sooner', 'Later', 'Undated']);
    const page = await as(a, (tx) => tx.task.findMany({ where: { title: { in: ['Undated', 'Later', 'Sooner'] } }, orderBy: [{ dueAt: nullsLast('desc') }], skip: 1, take: 2 }));
    expect(page.map((t) => t.title)).toEqual(['Sooner', 'Undated']);

    await as(a, (tx) =>
      tx.lead.createMany({
        data: [
          { tenantId: a.tenantId, fullName: 'Q', status: 'QUALIFIED', estimatedValue: 0.1 + 0.2 },
          { tenantId: a.tenantId, fullName: 'N', status: 'NEW', estimatedValue: 10.005 },
          { tenantId: a.tenantId, fullName: 'C', status: 'CONTACTED' },
        ],
      }),
    );
    const leads = await as(a, (tx) => tx.lead.findMany({ where: { fullName: { in: ['Q', 'N', 'C'] } }, orderBy: { status: 'asc' } }));
    expect(leads.map((l) => l.status)).toEqual(['NEW', 'CONTACTED', 'QUALIFIED']);
    expect(leads.map((l) => l.estimatedValue)).toEqual([10.01, null, 0.3]);
  });
});
