import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Candidate } from '../src/crm/enrichment/candidates';
import { type CompanyNow, merge } from '../src/crm/enrichment/merge';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Removing unwanted information from companies and contacts (ADR 0097): single values, list items and employees. */
describe('removing company and contact information', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Remove Info Co');
    http = api(owner);
  });
  afterAll(async () => {
    await app.close();
  });

  it('removes one company value or list item, and auto-fill never writes it back', async () => {
    const created = await http
      .post('/companies', {
        name: 'Tidy Panels',
        industry: 'Market research',
        legalName: 'Tidy Panels Ltd',
        services: ['Online panels'],
        emails: [{ value: 'hello@tidy.example', primary: true }],
        phones: [{ value: '+44 20 7946 0001', primary: true }],
        notes: 'Stale note',
      })
      .expect(201);
    const id = created.body.id as string;
    const web = { source: 'WEBSITE', url: 'https://tidy.example', confidence: 'high' } as const;
    const found = [
      { ...web, field: 'services', value: ['Found service'] },
      { ...web, field: 'emails', value: [{ value: 'old@tidy.example', label: null }] },
    ] as Candidate[];
    // An auto-fill run adds a service and an email, the way it saves them.
    await asTenant(owner.tenantId, async (tx) => {
      const row = await tx.company.findUniqueOrThrow({ where: { id } });
      const r = merge(row as unknown as CompanyNow, found, 'run-1', new Date());
      expect(r.fills.map((f) => f.field).sort()).toEqual(['emails', 'services']);
      await tx.company.update({ where: { id }, data: { ...r.data, fieldSources: r.fieldSources } as never });
    });
    expect((await http.get(`/companies/${id}`).expect(200)).body.services).toEqual(['Online panels', 'Found service']);

    // One field to empty, one list item out, a note gone: each is a plain edit.
    await http.patch(`/companies/${id}`, { legalName: null }).expect(200);
    await http.patch(`/companies/${id}`, { services: ['Online panels'] }).expect(200);
    await http.patch(`/companies/${id}`, { emails: [{ value: 'hello@tidy.example', primary: true }] }).expect(200);
    await http.patch(`/companies/${id}`, { notes: null }).expect(200);
    // Removing the primary phone clears the primary field too.
    await http.patch(`/companies/${id}`, { phones: [] }).expect(200);

    const c = (await http.get(`/companies/${id}`).expect(200)).body;
    expect(c.legalName).toBeNull();
    expect(c.industry).toBe('Market research');
    expect(c.services).toEqual(['Online panels']);
    expect(c.emails.map((e: { value: string }) => e.value)).toEqual(['hello@tidy.example']);
    expect(c.primaryEmail).toBe('hello@tidy.example');
    expect(c.phones).toEqual([]);
    expect(c.primaryPhone).toBeNull();
    expect(c.notes).toBeNull();

    // The next auto-fill run finds the removed values again and writes none of them.
    const row = await asTenant(owner.tenantId, (tx) => tx.company.findUniqueOrThrow({ where: { id } }));
    const again = merge(row as unknown as CompanyNow, [...found, { ...web, field: 'legalName', value: 'Tidy Panels Limited' } as Candidate], 'run-2', new Date());
    expect(again.fills).toEqual([]);
    expect(Object.keys(again.data)).toEqual([]);

    // Each removal is in the audit log like any edit.
    const edits = await asTenant(owner.tenantId, (tx) => tx.auditLog.count({ where: { tenantId: owner.tenantId, entityId: id, action: { contains: 'update' } } }));
    expect(edits).toBeGreaterThanOrEqual(5);
  });

  it('removes one contact value: designation, an email, the location and remarks', async () => {
    const companyId = (await http.post('/companies', { name: 'Contact Tidy Ltd' }).expect(201)).body.id as string;
    const id = (
      await http
        .post('/contacts', {
          firstName: 'Asha',
          lastName: 'Rao',
          companyId,
          jobTitle: 'Old title',
          department: 'Research',
          country: 'IN',
          city: 'Pune',
          remarks: 'Unwanted remark',
          emails: [{ value: 'asha@tidy.example', primary: true }, { value: 'asha.old@tidy.example' }],
        })
        .expect(201)
    ).body.id as string;

    await http.patch(`/contacts/${id}`, { jobTitle: null }).expect(200);
    await http.patch(`/contacts/${id}`, { emails: [{ value: 'asha.old@tidy.example', primary: false }] }).expect(200);
    await http.patch(`/contacts/${id}`, { country: null, city: null, state: null }).expect(200);
    await http.patch(`/contacts/${id}`, { remarks: null }).expect(200);

    const c = (await http.get(`/contacts/${id}`).expect(200)).body;
    expect(c.jobTitle).toBeNull();
    expect(c.department).toBe('Research');
    // The one email left becomes the primary one.
    expect(c.emails).toMatchObject([{ value: 'asha.old@tidy.example', primary: true }]);
    expect(c.emails).toHaveLength(1);
    expect(c.email).toBe('asha.old@tidy.example');
    expect(c.country).toBeNull();
    expect(c.city).toBeNull();
    expect(c.remarks).toBeNull();
  });

  it('deletes one, several or all of a company’s employees (more than one page), with the password', async () => {
    const companyId = (await http.post('/companies', { name: 'Many People Inc' }).expect(201)).body.id as string;
    const keepId = (await http.post('/companies', { name: 'Other Employer' }).expect(201)).body.id as string;
    for (let i = 0; i < 130; i++) await http.post('/contacts', { firstName: `Sweep ${i}`, companyId }).expect(201);
    const other = (await http.post('/contacts', { firstName: 'Keeper', companyId: keepId }).expect(201)).body.id as string;
    const employees = async () => (await http.get(`/companies/${companyId}/employees`).expect(200)).body as { id: string }[];
    const ids = (await employees()).map((r) => r.id);
    expect(ids).toHaveLength(130);

    // One.
    await http.delUnconfirmed(`/contacts/${ids[0]}`).expect(403);
    await http.del(`/contacts/${ids[0]}`).expect(204);
    // Several.
    expect((await http.postConfirmed('/records/bulk', { entity: 'contacts', ids: ids.slice(1, 4), action: 'delete' }).expect(200)).body).toEqual({ updated: 3, failed: [] });
    expect(await employees()).toHaveLength(126);
    // All the rest at once: more than the 100 a table page holds. The password is required.
    const rest = (await employees()).map((r) => r.id);
    await http.post('/records/bulk', { entity: 'contacts', ids: rest, action: 'delete' }).expect(403);
    const res = await http.postConfirmed('/records/bulk', { entity: 'contacts', ids: rest, action: 'delete' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ updated: 126, failed: [] });
    expect(await employees()).toHaveLength(0);
    // Another company's employee is untouched.
    await http.get(`/contacts/${other}`).expect(200);
  }, 120_000);

  it('needs write access to remove anything', async () => {
    const companyId = (await http.post('/companies', { name: 'Read Only Co', industry: 'Panels' }).expect(201)).body.id as string;
    const contact = (await http.post('/contacts', { firstName: 'Kept', companyId }).expect(201)).body.id as string;
    const viewer = api(await inviteMember(app, owner, 'viewer'));
    await viewer.patch(`/companies/${companyId}`, { industry: null }).expect(403);
    await viewer.postConfirmed('/records/bulk', { entity: 'contacts', ids: [contact], action: 'delete' }).expect(403);
    expect((await http.get(`/companies/${companyId}`).expect(200)).body.industry).toBe('Panels');
    await http.get(`/contacts/${contact}`).expect(200);
  }, 60_000);
});
