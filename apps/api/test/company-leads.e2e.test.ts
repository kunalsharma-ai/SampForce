import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/** Phase 2b of the company-centric CRM (ADR 0060): the lead form, drafts, branches, ownership, files, employee stats. */
describe('company leads', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let rep: TestUser & { userId: string };
  let rep2: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  let ownerId: string;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    http = api(owner);
    rep = await inviteMember(app, owner, 'member');
    rep2 = await inviteMember(app, owner, 'member');
    manager = await inviteMember(app, owner, 'manager');
    ownerId = ((await http.get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    const designations = (await http.get('/crm-config/designations').expect(200)).body as Array<{ id: string; name: string }>;
    const bde = designations.find((d) => d.name === 'Business Development Executive')!;
    await http.patch(`/tenants/current/members/${mId(rep.userId)}/org`, { designationId: bde.id, reportingManagerId: manager.userId }).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('saves a company lead with branches and employees in one go, numbered, with creator, owner, manager and POC apart', async () => {
    const statuses = (await http.get('/crm-config/statuses?kind=COMPANY').expect(200)).body as Array<{ id: string; name: string }>;
    const discussion = statuses.find((s) => s.name === 'Discussion Phase')!;
    const draft = (await http.post('/company-leads/drafts', { step: 3, data: { company: { name: 'Acme Panels' } } }).expect(201)).body;
    const res = (
      await http
        .post('/company-leads', {
          draftId: draft.id,
          company: {
            name: 'Acme Panels', website: 'acmepanels.example', country: 'IN', state: 'MH', city: 'Pune', industry: 'Market research',
            emails: [{ value: 'info@acmepanels.example', primary: true }, { value: 'sales@acmepanels.example' }],
            ownerId: rep.userId, pocUserId: manager.userId, statusId: discussion.id, notes: 'Met at the Quirks event.',
          },
          branches: [{ name: 'Berlin office', country: 'DE', city: 'Berlin', email: 'berlin@acmepanels.example' }],
          employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead', emails: [{ value: 'priya@acmepanels.example' }] }],
        })
        .expect(201)
    ).body;
    const c = res.company;
    expect(c.leadNumber).toBe('FRFS01');
    expect(c.createdBy.id).toBe(ownerId);
    expect(c.ownerPerson).toMatchObject({ id: rep.userId, designation: 'Business Development Executive' });
    // The assigned manager defaults to the owner's reporting manager; the POC is kept separately.
    expect(c.manager.id).toBe(manager.userId);
    expect(c.poc.id).toBe(manager.userId);
    expect(c.status.name).toBe('Discussion Phase');
    expect(c.primaryEmail).toBe('info@acmepanels.example');
    expect(c.branchCount).toBe(1);
    expect(res.branchIds).toHaveLength(1);
    const emp = (await http.get(`/contacts/${res.employeeIds[0]}`).expect(200)).body;
    expect(emp).toMatchObject({ fullName: 'Priya Nair', company: { id: c.id }, email: 'priya@acmepanels.example', status: { name: 'New Contact' } });
    // Employees default to the lead owner as their sales executive.
    expect(emp.owner.id).toBe(rep.userId);
    // The draft is gone; the first assignment is in the history and the new owner was told.
    await http.get(`/company-leads/drafts/${draft.id}`).expect(404);
    const history = (await http.get(`/companies/${c.id}/owner-history`).expect(200)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: null, to: { id: rep.userId }, by: { id: ownerId } });
    const notes = (await api(rep).get('/notifications').expect(200)).body.items as Array<{ type: string; title: string; link: string }>;
    expect(notes.find((n) => n.type === 'company.assigned')).toMatchObject({ title: 'Company assigned to you: FRFS01 Acme Panels', link: `/app/companies/${c.id}` });
  });

  it('saves nothing when any part of the lead is invalid', async () => {
    const before = (await http.get('/companies?q=Broken').expect(200)).body.total;
    const res = await http.post('/company-leads', { company: { name: 'Broken Co' }, employees: [{ firstName: 'A', statusId: '00000000-0000-4000-8000-000000000000' }] }).expect(400);
    expect(res.body.error.details[0].path).toBe('employees.0.statusId');
    expect((await http.get('/companies?q=Broken').expect(200)).body.total).toBe(before);
    await http.post('/company-leads', { company: { name: '' } }).expect(400);
  });

  it('keeps drafts private to the person writing them', async () => {
    const d = (await api(rep).post('/company-leads/drafts', { step: 0, data: { company: { name: 'Half Done Ltd' } } }).expect(201)).body;
    expect(d.title).toBe('Half Done Ltd');
    const saved = (await api(rep).put(`/company-leads/drafts/${d.id}`, { step: 4, data: { company: { name: 'Half Done Ltd', city: 'Leeds' } } }).expect(200)).body;
    expect(saved.step).toBe(4);
    expect((await api(rep).get('/company-leads/drafts').expect(200)).body.map((x: { id: string }) => x.id)).toContain(d.id);
    expect((await http.get('/company-leads/drafts').expect(200)).body.map((x: { id: string }) => x.id)).not.toContain(d.id);
    await http.get(`/company-leads/drafts/${d.id}`).expect(404);
    await http.del(`/company-leads/drafts/${d.id}`).expect(404);
    await api(rep).del(`/company-leads/drafts/${d.id}`).expect(204);
    await api(rep).post('/company-leads/drafts', { step: 9, data: {} }).expect(400);
  });

  it('lets people give leads only to those they may assign to', async () => {
    const people = (await api(rep).get('/company-leads/people').expect(200)).body as Array<{ id: string; assignable: boolean; designation: string | null }>;
    expect(people.find((p) => p.id === rep.userId)).toMatchObject({ assignable: true, designation: 'Business Development Executive' });
    expect(people.find((p) => p.id === rep2.userId)!.assignable).toBe(false);
    // A rep (own records) cannot give a lead away; their manager (team) can give it to people reporting to them.
    await api(rep).post('/company-leads', { company: { name: 'Given Away', ownerId: rep2.userId } }).expect(403);
    const mine = (await api(rep).post('/company-leads', { company: { name: 'Rep Lead' } }).expect(201)).body.company;
    expect(mine.ownerPerson.id).toBe(rep.userId);
    await api(manager).post(`/companies/${mine.id}/owner`, { ownerId: rep2.userId }).expect(403);
    const fromManager = (await api(manager).post('/company-leads', { company: { name: 'Manager Lead', ownerId: rep.userId } }).expect(201)).body.company;
    expect(fromManager.ownerPerson.id).toBe(rep.userId);
  });

  it('transfers ownership with a reason, keeps the creator, records the history and notifies the new owner', async () => {
    const c = (await http.post('/company-leads', { company: { name: 'Nordlicht Research GmbH', ownerId: rep.userId } }).expect(201)).body.company;
    const moved = (await http.post(`/companies/${c.id}/owner`, { ownerId: rep2.userId, reason: 'HIGH_VALUE', note: 'Big tracker study, please lead.' }).expect(200)).body;
    expect(moved.ownerPerson.id).toBe(rep2.userId);
    expect(moved.createdBy.id).toBe(ownerId);
    // rep2 has no reporting manager, so the assigned manager is cleared with the move.
    expect(moved.manager).toBeNull();
    const history = (await http.get(`/companies/${c.id}/owner-history`).expect(200)).body;
    expect(history[0]).toMatchObject({ from: { id: rep.userId }, to: { id: rep2.userId }, reason: 'HIGH_VALUE', note: 'Big tracker study, please lead.' });
    const notes = (await api(rep2).get('/notifications').expect(200)).body.items as Array<{ title: string; body: string }>;
    expect(notes.find((n) => n.title.includes('Nordlicht'))?.body).toContain('Big tracker study');
    await http.post(`/companies/${c.id}/owner`, { ownerId: rep2.userId, reason: 'NOT_A_REASON' }).expect(400);
  });

  it('adds, edits and removes branches, keeping the branch count', async () => {
    const c = (await http.post('/companies', { name: 'Maple Insights' }).expect(201)).body;
    const b = (await http.post(`/companies/${c.id}/branches`, { name: 'Toronto HQ', country: 'CA', city: 'Toronto', phone: '+1 416 555 0100', website: 'maple.example' }).expect(201)).body;
    expect(b).toMatchObject({ name: 'Toronto HQ', country: 'CA', website: 'https://maple.example' });
    await http.post(`/companies/${c.id}/branches`, { name: 'Vancouver', country: 'CA' }).expect(201);
    expect((await http.get(`/companies/${c.id}`).expect(200)).body.branchCount).toBe(2);
    await http.put(`/companies/${c.id}/branches/${b.id}`, { name: 'Toronto head office', country: 'CA', city: 'Toronto' }).expect(200);
    const list = (await http.get(`/companies/${c.id}/branches`).expect(200)).body;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Toronto head office', 'Vancouver']);
    await http.del(`/companies/${c.id}/branches/${b.id}`).expect(204);
    expect((await http.get(`/companies/${c.id}`).expect(200)).body.branchCount).toBe(1);
    await http.post(`/companies/${c.id}/branches`, { name: '' }).expect(400);
    // A rep who cannot see this company cannot reach its branches.
    await api(rep).get(`/companies/${c.id}/branches`).expect(404);
  });

  it('keeps files with the lead for the team', async () => {
    const c = (await http.post('/companies', { name: 'Files Co' }).expect(201)).body;
    const up = await owner.agent.post(`/api/v1/companies/${c.id}/files?name=brief.pdf`).set('origin', ORIGIN).set('content-type', 'application/pdf').send(Buffer.from('%PDF-1.4 brief')).expect(201);
    expect(up.body).toMatchObject({ name: 'brief.pdf', contentType: 'application/pdf', sizeBytes: 14 });
    expect((await http.get(`/companies/${c.id}/files`).expect(200)).body).toHaveLength(1);
    const dl = await http.get(`/company-files/${up.body.id}/download`).expect(200);
    expect(dl.headers['content-disposition']).toContain('brief.pdf');
    await owner.agent.post(`/api/v1/companies/${c.id}/files?name=x.exe`).set('origin', ORIGIN).set('content-type', 'application/x-msdownload').send(Buffer.from('MZ')).expect(400);
    await api(rep).get(`/company-files/${up.body.id}/download`).expect(404);
    await http.del(`/company-files/${up.body.id}`).expect(204);
    expect((await http.get(`/companies/${c.id}/files`).expect(200)).body).toHaveLength(0);
  });

  it('counts an employee’s emails, calls, meetings and pending follow-ups', async () => {
    const c = (await http.post('/companies', { name: 'Stats Co' }).expect(201)).body;
    const e = (await http.post('/contacts', { firstName: 'Lena', companyId: c.id, nextFollowUpAt: '2030-01-05T09:00:00Z' }).expect(201)).body;
    await http.post('/activities', { type: 'CALL', subject: 'Intro call', contactId: e.id }).expect(201);
    await http.post('/activities', { type: 'EMAIL', subject: 'Sent the capabilities deck', contactId: e.id }).expect(201);
    await http.post('/activities', { type: 'MEETING', subject: 'Scoping meeting', contactId: e.id, occurredAt: '2029-12-01T10:00:00Z' }).expect(201);
    await http.post('/tasks', { title: 'Send proposal', contactId: e.id, dueAt: '2029-12-20T09:00:00Z' }).expect(201);
    const s = (await http.get(`/contacts/${e.id}/stats`).expect(200)).body;
    expect(s).toMatchObject({ emailsSent: 1, responsesReceived: 0, calls: 1, meetings: 1, followUpsPending: 1, nextFollowUpAt: '2029-12-20T09:00:00.000Z' });
    expect(s.latestUpdate).toMatchObject({ type: 'MEETING', subject: 'Scoping meeting' });
    await api(rep).get(`/contacts/${e.id}/stats`).expect(404);
  });
});
