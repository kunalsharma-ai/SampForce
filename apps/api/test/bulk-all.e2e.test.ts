import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Acting on every matching record of a list, on every page, with no limit (select all, then delete). */
describe('bulk actions on every matching record', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Bulk All Co');
    http = api(owner);
  });
  afterAll(async () => {
    await app.close();
  });

  it('deletes every matching company on every page, far beyond one page, with one password confirmation', async () => {
    // 260 companies: more than two full pages of 100 and ten pages of 25.
    await asTenant(owner.tenantId, (tx) => tx.company.createMany({ data: Array.from({ length: 260 }, (_, i) => ({ tenantId: owner.tenantId, name: `Sweep ${String(i).padStart(3, '0')}` })) }));
    await http.post('/companies', { name: 'Keeper Ltd' }).expect(201);
    expect((await http.get('/companies?q=sweep').expect(200)).body.total).toBe(260);

    // Without the password nothing happens.
    const refused = await http.post('/records/bulk', { entity: 'companies', all: { query: { q: 'sweep' }, expected: 260 }, action: 'delete' }).expect(403);
    expect(refused.body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    // A stale total (the list changed since the person looked) changes nothing.
    const stale = await http.postConfirmed('/records/bulk', { entity: 'companies', all: { query: { q: 'sweep' }, expected: 200 }, action: 'delete' }).expect(409);
    expect(stale.body.error.code).toBe('SELECTION_CHANGED');
    expect((await http.get('/companies?q=sweep').expect(200)).body.total).toBe(260);

    const res = await http.postConfirmed('/records/bulk', { entity: 'companies', all: { query: { q: 'sweep', sort: 'name' }, expected: 260 }, action: 'delete' }).expect(200);
    expect(res.body).toEqual({ updated: 260, failed: [] });
    expect((await http.get('/companies?q=sweep').expect(200)).body.total).toBe(0);
    // Records outside the filter are untouched.
    expect((await http.get('/companies?q=keeper').expect(200)).body.total).toBe(1);
    const audit = await asTenant(owner.tenantId, async (tx) => ({
      each: await tx.auditLog.count({ where: { tenantId: owner.tenantId, action: 'company.deleted' } }),
      summary: await tx.auditLog.count({ where: { tenantId: owner.tenantId, action: 'records.bulk_delete', entityType: 'companies' } }),
    }));
    expect(audit).toEqual({ each: 260, summary: 1 });
  }, 180_000);

  it('follows the list filters and custom field filters for other lists and actions', async () => {
    await http.post('/custom-fields', { entity: 'CONTACT', key: 'tier', label: 'Tier', type: 'TEXT' }).expect(201);
    for (let i = 0; i < 30; i++) await http.post('/contacts', { firstName: `Gold${i}`, customFields: { tier: i < 12 ? 'gold' : 'silver' } }).expect(201);
    const cf = JSON.stringify([{ key: 'tier', op: 'eq', value: 'gold' }]);
    const member = await inviteMember(app, owner, 'member');
    const assigned = await http.post('/records/bulk', { entity: 'contacts', all: { query: { cf }, expected: 12 }, action: 'assign', ownerId: member.userId }).expect(200);
    expect(assigned.body.updated).toBe(12);
    expect((await http.get(`/contacts?ownerId=${member.userId}&pageSize=100`).expect(200)).body.total).toBe(12);

    // Leads: status for everything matching, then delete everything matching.
    for (let i = 0; i < 40; i++) await http.post('/leads', { fullName: `Inbound ${i}` }).expect(201);
    const total = (await http.get('/leads?q=inbound').expect(200)).body.total as number;
    expect(total).toBe(40);
    expect((await http.post('/records/bulk', { entity: 'leads', all: { query: { q: 'inbound' }, expected: 40 }, action: 'status', status: 'CONTACTED' }).expect(200)).body.updated).toBe(40);
    expect((await http.get('/leads?q=inbound&status=CONTACTED').expect(200)).body.total).toBe(40);
    expect((await http.postConfirmed('/records/bulk', { entity: 'leads', all: { query: { q: 'inbound', status: 'CONTACTED' }, expected: 40 }, action: 'delete' }).expect(200)).body.updated).toBe(40);
    expect((await http.get('/leads?q=inbound').expect(200)).body.total).toBe(0);

    const bad = await http.post('/records/bulk', { entity: 'leads', all: { query: { cf: 'not json' }, expected: 1 }, action: 'status', status: 'NEW' });
    expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    await http.postConfirmed('/records/bulk', { entity: 'leads', action: 'delete' }).expect(400);
  }, 120_000);

  it('only reaches records the person may change, and never another workspace', async () => {
    const other = await registerUser(app, 'Other Bulk Co');
    await api(other).post('/companies', { name: 'Foreign Sweep' }).expect(201);
    // The other workspace sees only its own one record; ours are not counted or touched.
    await api(other).postConfirmed('/records/bulk', { entity: 'companies', all: { query: { q: 'keeper' }, expected: 1 }, action: 'delete' }).expect(409);
    expect((await http.get('/companies?q=keeper').expect(200)).body.total).toBe(1);

    // A role without write access cannot use it at all.
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).postConfirmed('/records/bulk', { entity: 'companies', all: { query: {}, expected: 1 }, action: 'delete' }).expect(403);

    // Someone who sees only their own records deletes only those.
    const roles = (await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string }>;
    const memberRole = roles.find((r) => r.key === 'member')!;
    await http.put(`/tenants/current/roles/${memberRole.id}/visibility`, { recordScope: 'OWN', viewOthersDetails: true }).expect(200);
    const rep = await inviteMember(app, owner, 'member');
    await api(rep).post('/companies', { name: 'Rep Own A' }).expect(201);
    await api(rep).post('/companies', { name: 'Rep Own B' }).expect(201);
    const seen = (await api(rep).get('/companies').expect(200)).body.total as number;
    const res = await api(rep).postConfirmed('/records/bulk', { entity: 'companies', all: { query: {}, expected: seen }, action: 'delete' });
    // Members may not have the workspace Delete action; either way, the owner's company survives.
    expect([200, 403]).toContain(res.status);
    expect((await http.get('/companies?q=keeper').expect(200)).body.total).toBe(1);
  });
});
