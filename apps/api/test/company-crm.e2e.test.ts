import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upgradeCompanyCrm } from '@dealflow/database';
import { api, asTenant, inviteMember, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/** Company-centric CRM foundations (ADR 0060): lead numbers, statuses, organisation, visibility, duplicates, geo. */
describe('company-centric CRM foundations', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    http = api(owner);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('lead numbers', () => {
    it('numbers company leads in order from the workspace initials and never accepts one from input', async () => {
      const a = (await http.post('/companies', { name: 'Alpha Insights' }).expect(201)).body;
      const b = (await http.post('/companies', { name: 'Beta Panels', leadNumber: 'HACK99' }).expect(201)).body;
      expect(a.leadNumber).toMatch(/^FRFS\d{2,}$/);
      expect(Number(b.leadNumber.slice(4))).toBe(Number(a.leadNumber.slice(4)) + 1);
      expect(a.createdBy).toMatchObject({ name: 'User Frequent Research Fieldwork Solutions' });
      expect(a.status).toMatchObject({ name: 'New Lead', color: '#7dd3fc' });
      const n = (await http.get('/crm-config/lead-numbering').expect(200)).body;
      expect(n).toMatchObject({ prefix: 'FRFS', digits: 2, isDefaultPrefix: true });
      expect(n.next).toBe(`FRFS${String(Number(b.leadNumber.slice(4)) + 1).padStart(2, '0')}`);
    });

    it('keeps numbers unique under concurrent creates', async () => {
      const made = await Promise.all(Array.from({ length: 8 }, (_, i) => http.post('/companies', { name: `Parallel ${i}` }).expect(201)));
      const numbers = made.map((r) => r.body.leadNumber as string);
      expect(new Set(numbers).size).toBe(8);
    });

    it('changes the prefix for new leads only, or re-letters existing numbers keeping the sequence', async () => {
      const before = (await http.post('/companies', { name: 'Gamma Field' }).expect(201)).body;
      await http.put('/crm-config/lead-numbering', { prefix: 'ab', digits: 3 }).expect(200);
      const after = (await http.post('/companies', { name: 'Delta Field' }).expect(201)).body;
      expect(after.leadNumber).toMatch(/^AB\d{3}$/);
      expect((await http.get(`/companies/${before.id}`).expect(200)).body.leadNumber).toBe(before.leadNumber);

      const res = (await http.put('/crm-config/lead-numbering', { prefix: 'FRFS', digits: 2, applyToExisting: true }).expect(200)).body;
      expect(res.isDefaultPrefix).toBe(false);
      const seq = Number(after.leadNumber.slice(2));
      expect((await http.get(`/companies/${after.id}`).expect(200)).body.leadNumber).toBe(`FRFS${String(seq).padStart(2, '0')}`);
      await http.put('/crm-config/lead-numbering', { prefix: 'bad prefix!', digits: 2 }).expect(400);
    });

    it('backfills numbers for companies created before the upgrade, oldest first', async () => {
      const t = await registerUser(app, 'Legacy Co', { plan: 'free' });
      const db = ownerClient();
      try {
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
          const c = await db.company.create({ data: { tenantId: t.tenantId, name: `Old ${i}`, createdAt: new Date(Date.UTC(2024, 0, 1 + i)), ownerId: null } });
          ids.push(c.id);
        }
        await db.counter.deleteMany({ where: { id: `upgrade:company-crm-1:${t.tenantId}` } });
        await upgradeCompanyCrm(db);
        const rows = await db.company.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
        expect(rows.map((r) => r.leadNumber)).toEqual(['LC01', 'LC02', 'LC03']);
        expect(rows.every((r) => r.statusId)).toBe(true);
        // Running again changes nothing.
        await upgradeCompanyCrm(db);
        expect((await db.company.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } })).map((r) => r.leadNumber)).toEqual(['LC01', 'LC02', 'LC03']);
      } finally {
        await db.$disconnect();
      }
    });
  });

  describe('statuses', () => {
    it('lists the default company and employee statuses with colours', async () => {
      const company = (await http.get('/crm-config/statuses?kind=COMPANY').expect(200)).body;
      expect(company).toHaveLength(15);
      expect(company[0]).toMatchObject({ name: 'New Lead', isDefault: true, meaning: 'NEW' });
      expect(company.find((s: { name: string }) => s.name === 'Rejected').color).toBe('#ef4444');
      const employee = (await http.get('/crm-config/statuses?kind=EMPLOYEE').expect(200)).body;
      expect(employee).toHaveLength(16);
      expect(employee[0].name).toBe('New Contact');
    });

    it('adds, renames, recolours, reorders, defaults, deactivates and deletes statuses', async () => {
      const s = (await http.post('/crm-config/statuses', { kind: 'COMPANY', name: 'Pilot Project', color: '#AABBCC', description: 'Trial job' }).expect(201)).body;
      expect(s).toMatchObject({ color: '#aabbcc', meaning: 'ACTIVE', isDefault: false });
      await http.post('/crm-config/statuses', { kind: 'COMPANY', name: 'pilot project', color: '#112233' }).expect(409);
      await http.post('/crm-config/statuses', { kind: 'COMPANY', name: 'Bad', color: 'red' }).expect(400);
      const renamed = (await http.put(`/crm-config/statuses/${s.id}`, { name: 'Pilot Job', color: '#123456' }).expect(200)).body;
      expect(renamed).toMatchObject({ name: 'Pilot Job', color: '#123456' });

      const all = (await http.get('/crm-config/statuses?kind=COMPANY').expect(200)).body as Array<{ id: string }>;
      const order = [s.id, ...all.map((x) => x.id).filter((id) => id !== s.id)];
      const reordered = (await http.put('/crm-config/statuses/order', { kind: 'COMPANY', ids: order }).expect(200)).body;
      expect(reordered[0].id).toBe(s.id);
      await http.put('/crm-config/statuses/order', { kind: 'COMPANY', ids: [s.id] }).expect(400);

      await http.put(`/crm-config/statuses/${s.id}`, { isDefault: true }).expect(200);
      const created = (await http.post('/companies', { name: 'Default Test' }).expect(201)).body;
      expect(created.status.name).toBe('Pilot Job');
      await http.put(`/crm-config/statuses/${s.id}`, { archived: true }).expect(400); // still the default
      const newLead = all.find((x) => (x as unknown as { name: string }).name === 'New Lead')!;
      await http.put(`/crm-config/statuses/${newLead.id}`, { isDefault: true }).expect(200);

      // In use: cannot be deleted, can be deactivated, and then cannot be picked.
      await http.del(`/crm-config/statuses/${s.id}`).expect(409);
      await http.put(`/crm-config/statuses/${s.id}`, { archived: true }).expect(200);
      expect((await http.get(`/companies/${created.id}`).expect(200)).body.status.name).toBe('Pilot Job');
      await http.post('/companies', { name: 'X', statusId: s.id }).expect(400);
      await http.patch(`/companies/${created.id}`, { statusId: newLead.id }).expect(200);
      await http.del(`/crm-config/statuses/${s.id}`).expect(204);
    });

    it('tracks who changed a company or employee status and when', async () => {
      const statuses = (await http.get('/crm-config/statuses?kind=EMPLOYEE').expect(200)).body as Array<{ id: string; name: string }>;
      const company = (await http.post('/companies', { name: 'Status Corp' }).expect(201)).body;
      const contact = (await http.post('/contacts', { firstName: 'Ira', companyId: company.id }).expect(201)).body;
      expect(contact.status.name).toBe('New Contact');
      const awaiting = statuses.find((s) => s.name === 'Awaiting Response')!;
      const updated = (await http.patch(`/contacts/${contact.id}`, { statusId: awaiting.id }).expect(200)).body;
      expect(updated.status.name).toBe('Awaiting Response');
      expect(updated.statusChangedBy.name).toBe('User Frequent Research Fieldwork Solutions');
      const filtered = (await http.get(`/contacts?statusId=${awaiting.id}`).expect(200)).body;
      expect(filtered.items.map((c: { id: string }) => c.id)).toEqual([contact.id]);
      // Employee statuses are not company statuses.
      const companyStatuses = (await http.get('/crm-config/statuses?kind=COMPANY').expect(200)).body as Array<{ id: string }>;
      await http.patch(`/contacts/${contact.id}`, { statusId: companyStatuses[0]!.id }).expect(400);
    });

    it('refuses changes from people without crm:configure', async () => {
      const rep = await inviteMember(app, owner, 'member');
      await api(rep).get('/crm-config/statuses?kind=COMPANY').expect(200);
      await api(rep).post('/crm-config/statuses', { kind: 'COMPANY', name: 'Nope', color: '#000000' }).expect(403);
      await api(rep).put('/crm-config/lead-numbering', { prefix: 'X', digits: 2 }).expect(403);
    });
  });

  describe('company and employee details', () => {
    it('stores several emails, phones and links with one primary each', async () => {
      const c = (
        await http
          .post('/companies', {
            name: 'Multi Contact Ltd',
            emails: [{ value: 'sales@multi.test' }, { value: 'INFO@multi.test', primary: true }, { value: 'info@multi.test' }],
            phones: [{ value: '+91 98765 43210', label: 'Office' }],
            websites: [{ value: 'multi.test' }],
            linkedinUrls: [{ value: 'https://www.linkedin.com/company/multi-contact/' }],
            country: 'in',
            state: 'Maharashtra',
            city: 'Mumbai',
            foundedYear: 1999,
            companySize: '51-200',
            addresses: [{ label: 'Pune office', country: 'IN', city: 'Pune' }],
          })
          .expect(201)
      ).body;
      expect(c.emails).toEqual([
        { value: 'sales@multi.test', label: null, primary: false },
        { value: 'info@multi.test', label: null, primary: true },
      ]);
      expect(c.primaryEmail).toBe('info@multi.test');
      expect(c.primaryPhone).toBe('+91 98765 43210');
      expect(c.website).toBe('https://multi.test');
      expect(c.domain).toBe('multi.test');
      expect(c.linkedinUrl).toBe('https://www.linkedin.com/company/multi-contact/');
      expect(c.addresses).toEqual([{ label: 'Pune office', country: 'IN', city: 'Pune' }]);

      const e = (await http.post('/contacts', { firstName: 'Neha', companyId: c.id, emails: [{ value: 'neha@multi.test' }, { value: 'n@multi.test', primary: true }], jobTitle: 'Procurement Head', department: 'Procurement' }).expect(201)).body;
      expect(e.email).toBe('n@multi.test');
      expect(e.emails).toHaveLength(2);
      // Search finds them by any address.
      expect((await http.get('/companies?q=sales@multi.test').expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([c.id]);
      expect((await http.get('/contacts?q=neha@multi.test').expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([e.id]);
      expect((await http.get(`/companies?q=${c.leadNumber}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([c.id]);
    });

    it('finds duplicate companies and employees by name, domain, email, phone and LinkedIn', async () => {
      const c = (await http.post('/companies', { name: 'Duplicate Research Pvt. Ltd.', website: 'https://www.dupres.test', phones: [{ value: '+44 20 7946 0000' }] }).expect(201)).body;
      const byName = (await http.post('/companies/check-duplicates', { name: 'duplicate research' }).expect(200)).body;
      expect(byName).toEqual([expect.objectContaining({ id: c.id, reasons: ['name'], leadNumber: c.leadNumber, visible: true })]);
      const byDomain = (await http.post('/companies/check-duplicates', { name: 'Other name', emails: ['ops@dupres.test'] }).expect(200)).body;
      expect(byDomain[0]).toMatchObject({ id: c.id, reasons: ['domain'] });
      const byPhone = (await http.post('/companies/check-duplicates', { phones: ['020 7946 0000'] }).expect(200)).body;
      expect(byPhone[0].reasons).toEqual(['phone']);
      expect((await http.post('/companies/check-duplicates', { name: 'Duplicate Research', excludeId: c.id }).expect(200)).body).toEqual([]);

      const p = (await http.post('/contacts', { firstName: 'Omar', email: 'omar@dupres.test', linkedinUrl: 'https://linkedin.com/in/omar-k' }).expect(201)).body;
      const dup = (await http.post('/contacts/check-duplicates', { emails: ['OMAR@dupres.test'], linkedinUrl: 'https://www.linkedin.com/in/omar-k/' }).expect(200)).body;
      expect(dup).toEqual([expect.objectContaining({ id: p.id, reasons: expect.arrayContaining(['email', 'linkedin']) })]);
    });
  });

  describe('organisation and record visibility', () => {
    let rep1: TestUser & { userId: string };
    let rep2: TestUser & { userId: string };
    let manager: TestUser & { userId: string };
    let viewerRole: { id: string };
    let memberships: Array<{ membershipId: string; userId: string }>;

    beforeAll(async () => {
      rep1 = await inviteMember(app, owner, 'member');
      rep2 = await inviteMember(app, owner, 'member');
      manager = await inviteMember(app, owner, 'manager');
      memberships = (await http.get('/tenants/current/members').expect(200)).body;
      viewerRole = ((await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string }>).find((r) => r.key === 'member')!;
    });
    const mId = (userId: string) => memberships.find((m) => m.userId === userId)!.membershipId;

    it('sets designation, department and reporting manager, refusing loops', async () => {
      const designations = (await http.get('/crm-config/designations').expect(200)).body as Array<{ id: string; name: string; tier: string }>;
      expect(designations.map((d) => d.name)).toContain('Business Development Manager');
      const bdm = designations.find((d) => d.name === 'Business Development Manager')!;
      const bde = designations.find((d) => d.name === 'Business Development Executive')!;
      const dept = ((await http.get('/crm-config/departments').expect(200)).body as Array<{ id: string; name: string }>).find((d) => d.name === 'Business Development')!;
      const m = (await http.patch(`/tenants/current/members/${mId(manager.userId)}/org`, { designationId: bdm.id, departmentId: dept.id }).expect(200)).body;
      expect(m).toMatchObject({ designation: { name: 'Business Development Manager', tier: 'MANAGER' }, department: { name: 'Business Development' } });
      const r = (await http.patch(`/tenants/current/members/${mId(rep1.userId)}/org`, { designationId: bde.id, reportingManagerId: manager.userId }).expect(200)).body;
      expect(r.reportingManager).toEqual({ id: manager.userId, name: 'Member manager' });
      await http.patch(`/tenants/current/members/${mId(manager.userId)}/org`, { reportingManagerId: rep1.userId }).expect(400);
      await http.patch(`/tenants/current/members/${mId(rep1.userId)}/org`, { reportingManagerId: rep1.userId }).expect(400);
      await api(rep1).patch(`/tenants/current/members/${mId(rep1.userId)}/org`, { designationId: bdm.id }).expect(403);
    });

    it('shows reps their own and unassigned records, managers their team, owners everything', async () => {
      const mine = (await api(rep1).post('/companies', { name: 'Rep One Account', primaryEmail: 'buyer@rep1.test' }).expect(201)).body;
      const theirs = (await api(rep2).post('/companies', { name: 'Rep Two Account' }).expect(201)).body;
      const open = (await http.post('/companies', { name: 'Unassigned Account', ownerId: null }).expect(201)).body;
      expect(open.ownerPerson).toMatchObject({ name: 'User Frequent Research Fieldwork Solutions' });
      await http.patch(`/companies/${open.id}`, { ownerId: null }).expect(200);
      expect(mine.ownerPerson).toMatchObject({ id: rep1.userId, designation: 'Business Development Executive' });

      const seen = async (u: TestUser) => ((await api(u).get('/companies?pageSize=100').expect(200)).body.items as Array<{ id: string }>).map((c) => c.id);
      const r1 = await seen(rep1);
      expect(r1).toEqual(expect.arrayContaining([mine.id, open.id]));
      expect(r1).not.toContain(theirs.id);
      await api(rep1).get(`/companies/${theirs.id}`).expect(404);
      await api(rep1).patch(`/companies/${theirs.id}`, { name: 'x' }).expect(404);

      const mgr = await seen(manager);
      expect(mgr).toEqual(expect.arrayContaining([mine.id, open.id]));
      expect(mgr).not.toContain(theirs.id); // rep2 does not report to the manager
      expect(await seen(owner)).toEqual(expect.arrayContaining([mine.id, theirs.id, open.id]));

      // Duplicate checks still warn about records the rep cannot open, with names only.
      const dup = (await api(rep1).post('/companies/check-duplicates', { name: 'Rep Two Account' }).expect(200)).body;
      expect(dup).toEqual([expect.objectContaining({ id: theirs.id, visible: false, owner: expect.objectContaining({ id: rep2.userId }) })]);
      expect(dup[0]).not.toHaveProperty('primaryEmail');

      // Global search and export follow visibility too.
      const hits = (await api(rep1).get('/search?q=Account').expect(200)).body as Array<{ id: string }>;
      expect(hits.map((h) => h.id)).not.toContain(theirs.id);
    });

    it('hides the details of visible records someone else owns when the role says so', async () => {
      const company = (await api(rep1).post('/companies', { name: 'Detail Hidden Co', primaryEmail: 'boss@hidden.test', notes: 'secret' }).expect(201)).body;
      const managerRole = ((await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string }>).find((r) => r.key === 'manager')!;
      const res = (await http.put(`/tenants/current/roles/${managerRole.id}/visibility`, { recordScope: 'TEAM', viewOthersDetails: false }).expect(200)).body;
      expect(res).toMatchObject({ recordScope: 'TEAM', viewOthersDetails: false });
      // A fresh request picks up the role change.
      const seen = (await api(manager).get(`/companies/${company.id}`).expect(200)).body;
      expect(seen).toMatchObject({ name: 'Detail Hidden Co', restricted: true, primaryEmail: null, notes: null, emails: [] });
      expect(seen.leadNumber).toBe(company.leadNumber);
      expect(seen.status.name).toBe('New Lead');
      const st = ((await http.get('/crm-config/statuses?kind=COMPANY').expect(200)).body as Array<{ id: string; name: string }>).find((s) => s.name === 'Discussion Phase')!;
      await api(manager).patch(`/companies/${company.id}`, { statusId: st.id }).expect(200);
      const blocked = await api(manager).patch(`/companies/${company.id}`, { notes: 'overwrite' }).expect(400);
      expect(blocked.body.error.code).toBe('DETAILS_HIDDEN');
      // Exports leave hidden details blank (an administrator here, since managers cannot export).
      const admin = await inviteMember(app, owner, 'admin');
      const adminRole = ((await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string }>).find((r) => r.key === 'admin')!;
      await http.put(`/tenants/current/roles/${adminRole.id}/visibility`, { recordScope: 'ALL', viewOthersDetails: false }).expect(200);
      const csv = (await api(admin).get('/exports/companies').expect(200)).text;
      expect(csv).toContain('Detail Hidden Co');
      expect(csv).not.toContain('boss@hidden.test');
      await http.put(`/tenants/current/roles/${adminRole.id}/visibility`, { recordScope: 'ALL', viewOthersDetails: true }).expect(200);
      await http.put(`/tenants/current/roles/${managerRole.id}/visibility`, { recordScope: 'TEAM', viewOthersDetails: true }).expect(200);
      expect((await api(manager).get(`/companies/${company.id}`).expect(200)).body.primaryEmail).toBe('boss@hidden.test');
    });

    it('lets admins widen a rep role to everything and never narrows the owner role', async () => {
      const ownerRole = ((await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string }>).find((r) => r.key === 'owner')!;
      await http.put(`/tenants/current/roles/${ownerRole.id}/visibility`, { recordScope: 'OWN', viewOthersDetails: true }).expect(400);
      await http.put(`/tenants/current/roles/${viewerRole.id}/visibility`, { recordScope: 'ALL', viewOthersDetails: true }).expect(200);
      const count = (await api(rep1).get('/companies?pageSize=100').expect(200)).body.total;
      expect(count).toBe((await http.get('/companies?pageSize=100').expect(200)).body.total);
      await http.put(`/tenants/current/roles/${viewerRole.id}/visibility`, { recordScope: 'OWN', viewOthersDetails: true }).expect(200);
      const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.count({ where: { tenantId: owner.tenantId, action: 'role.visibility_changed' } }));
      expect(audit).toBeGreaterThanOrEqual(3);
    });

    it('applies visibility to employees and inbound leads', async () => {
      const company = (await api(rep2).post('/companies', { name: 'Rep Two Only' }).expect(201)).body;
      const emp = (await api(rep2).post('/contacts', { firstName: 'Hidden', companyId: company.id }).expect(201)).body;
      await api(rep1).get(`/contacts/${emp.id}`).expect(404);
      const lead = (await api(rep2).post('/leads', { fullName: 'Inbound Person' }).expect(201)).body.lead;
      await api(rep1).get(`/leads/${lead.id}`).expect(404);
      await api(manager).get(`/leads/${lead.id}`).expect(404);
      await http.get(`/leads/${lead.id}`).expect(200);
    });
  });

  describe('countries, regions and cities', () => {
    it('serves every country with dialling code, currency and time zones, and their regions and cities', async () => {
      const countries = (await http.get('/geo/countries').expect(200)).body as Array<{ code: string; dialCode: string; currency: string; timezones: string[] }>;
      expect(countries.length).toBeGreaterThanOrEqual(245);
      expect(countries.find((c) => c.code === 'IN')).toMatchObject({ dialCode: '91', currency: 'INR', timezones: ['Asia/Kolkata'] });
      expect(countries.find((c) => c.code === 'US')!.timezones).toContain('America/New_York');
      const regions = (await http.get('/geo/countries/in/regions').expect(200)).body as Array<{ code: string; name: string }>;
      expect(regions.find((r) => r.name === 'Maharashtra')).toMatchObject({ code: 'MH' });
      const cities = (await http.get('/geo/countries/IN/cities?region=MH&q=pu').expect(200)).body as Array<{ name: string }>;
      expect(cities.map((c) => c.name)).toContain('Pune');
      expect((await http.get('/geo/countries/DE/cities?q=mun').expect(200)).body[0].name).toBe('Munich');
      await http.get('/geo/countries/ZZ/regions').expect(404);
    });
  });
});
