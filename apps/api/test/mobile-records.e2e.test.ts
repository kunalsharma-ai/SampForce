import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { defaultMobileConfig, PASSWORD_CONFIRMATION_HEADER, type MobileAppConfig, type MobileRecord, type MobileRecordOptions, type MobileRecordPage } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, registerUser, startApp, type TestUser, workspacePerson, perWorkspaceDelete } from './helpers';

/**
 * Records on the phone (ADR 0072, M4): leads, contacts, follow-ups and tasks through the web's own services, with
 * the Mobile Configuration's field and module rules applied by the server in both directions.
 */
describe('mobile records', () => {
  let app: INestApplication;
  let owner: TestUser;
  let exec: TestUser & { userId: string; workspaceId: string };
  let ownerToken = '';
  let execToken = '';
  const http = () => request(app.getHttpServer());
  const signIn = (u: { email: string; password: string }) =>
    http()
      .post('/api/v1/mobile/auth/login')
      .send({ email: u.email, password: u.password, device: { platform: 'IOS', installId: `rec-${randomUUID().slice(0, 8)}`, model: 'iPhone 18', osVersion: '27', appVersion: '1.0.0' } });
  const phone = (token: string) => ({
    get: (url: string) => http().get(`/api/v1/mobile/records${url}`).set('authorization', `Bearer ${token}`),
    post: (url: string, body: object) => http().post(`/api/v1/mobile/records${url}`).set('authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => http().patch(`/api/v1/mobile/records${url}`).set('authorization', `Bearer ${token}`).send(body),
    /** Deletes the way the app does: confirms the password (the phone asks for it) and sends the one-time pass. */
    del: async (url: string, status: number) => {
      const password = token === ownerToken ? owner.password : exec.password;
      const pass = await http().post('/api/v1/auth/confirm-password').set('authorization', `Bearer ${token}`).send({ password }).expect(200);
      return http().delete(`/api/v1/mobile/records${url}`).set('authorization', `Bearer ${token}`).set(PASSWORD_CONFIRMATION_HEADER, pass.body.token).expect(status);
    },
  });
  const publish = async (change: (c: MobileAppConfig) => void) => {
    const draft = JSON.parse(JSON.stringify(defaultMobileConfig())) as MobileAppConfig;
    change(draft);
    await api(owner).put('/mobile-config/draft', draft).expect(200);
    await api(owner).post('/mobile-config/publish', { note: 'Records test' }).expect(200);
  };
  const hidden = { view: false, edit: false, create: false, delete: false };
  const viewOnly = { view: true, edit: false, create: false, delete: false };

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Records Org');
    // These tests grant Delete workspace by workspace (W2), so the organisation-wide switch is off.
    await perWorkspaceDelete(owner);
    exec = await workspacePerson(app, owner, 'EXECUTIVE', 'Field Exec');
    await asTenant(owner.tenantId, (tx) => tx.mobileAccess.create({ data: { tenantId: owner.tenantId, status: 'APPROVED', decisionStatus: 'APPROVED', decidedAt: new Date(), activatedAt: new Date(), activatedById: null } }));
    ownerToken = (await signIn(owner).expect(200)).body.accessToken;
    execToken = (await signIn(exec).expect(200)).body.accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('gives the pickers their choices', async () => {
    const o = (await phone(execToken).get('/options').expect(200)).body as MobileRecordOptions;
    expect(o.companyStatuses.length).toBeGreaterThan(0);
    expect(o.companyStatuses[0]).toEqual({ id: expect.any(String), name: expect.any(String), color: expect.any(String) });
    expect(o.followUpTypes.length).toBeGreaterThan(0);
    expect(o.people.map((p) => p.id)).toContain(exec.userId);
  });

  it('creates, lists, opens and edits a lead with the phone field names', async () => {
    const o = (await phone(ownerToken).get('/options').expect(200)).body as MobileRecordOptions;
    const created = (await phone(ownerToken).post('/companies', { name: 'Harbour Labs', website: 'https://harbour.example', city: 'Leeds', status: o.companyStatuses[0]!.id }).expect(201)).body as MobileRecord;
    expect(created).toMatchObject({ name: 'Harbour Labs', website: 'https://harbour.example', city: 'Leeds', status: { id: o.companyStatuses[0]!.id }, leadNumber: expect.any(String) });
    const page = (await phone(ownerToken).get('/companies?q=Harbour').expect(200)).body as MobileRecordPage;
    expect(page).toMatchObject({ page: 1, hasMore: false });
    expect(page.items.map((c) => c.id)).toEqual([created.id]);
    const edited = (await phone(ownerToken).patch(`/companies/${created.id}`, { city: 'York' }).expect(200)).body as MobileRecord;
    expect(edited.city).toBe('York');
    expect(((await phone(ownerToken).get(`/companies/${created.id}`).expect(200)).body as MobileRecord).city).toBe('York');
    // The web sees the same lead.
    expect((await api(owner).get(`/companies/${created.id}`).expect(200)).body.city).toBe('York');
  });

  it('reports invalid values by the phone field names', async () => {
    const res = await phone(ownerToken).post('/companies', { name: 'Bad Co', owner: 'not-a-uuid' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('owner');
    await phone(ownerToken).post('/companies', {}).expect(400);
    await phone(ownerToken).get('/deals').expect(404);
    await phone(ownerToken).get('/companies/not-a-uuid').expect(400);
  });

  it('hides fields a level may not see and refuses changes to them', async () => {
    await publish((c) => {
      c.fields.companies.website!.EXECUTIVE = hidden;
      c.fields.companies.city!.EXECUTIVE = viewOnly;
    });
    const mine = (await phone(execToken).post('/companies', { name: 'Exec Lead Ltd' }).expect(201)).body as MobileRecord;
    expect(mine.name).toBe('Exec Lead Ltd');
    expect('website' in mine).toBe(false);
    expect('city' in mine).toBe(true);
    const list = (await phone(execToken).get('/companies').expect(200)).body as MobileRecordPage;
    expect(list.items.every((c) => !('website' in c))).toBe(true);
    // Setting a hidden or view-only field is refused, naming the field; the record is unchanged.
    const r1 = await phone(execToken).patch(`/companies/${mine.id}`, { website: 'https://x.example' }).expect(403);
    expect(r1.body.error.code).toBe('MOBILE_FIELD_NOT_ALLOWED');
    const r2 = await phone(execToken).post('/companies', { name: 'Another', city: 'Hull' }).expect(403);
    expect(r2.body.error.code).toBe('MOBILE_FIELD_NOT_ALLOWED');
    await phone(execToken).patch(`/companies/${mine.id}`, { leadNumber: 'X-1' }).expect(403);
    // The Super Workspace still sees and edits the field.
    expect(((await phone(ownerToken).get(`/companies/${mine.id}`).expect(200)).body as MobileRecord).website).toBeNull();
  });

  it('lets only levels with the delete rule delete, and switches modules off', async () => {
    const lead = (await phone(execToken).post('/companies', { name: 'Short Lived' }).expect(201)).body as MobileRecord;
    // New workspaces cannot delete until the workspace above turns Delete on (workspace redesign W2).
    expect((await phone(execToken).del(`/companies/${lead.id}`, 403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    const granted = (await api(exec).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    await api(owner).put(`/workspaces/${exec.workspaceId}/permissions`, { actions: { ...granted, CRM: [...granted.CRM!, 'delete'] } }).expect(200);
    // Even then, the mobile configuration keeps delete off for executives by default.
    expect((await phone(execToken).del(`/companies/${lead.id}`, 403)).body.error.code).toBe('MOBILE_ACTION_NOT_ALLOWED');
    await phone(ownerToken).del(`/companies/${lead.id}`, 204);
    await phone(ownerToken).get(`/companies/${lead.id}`).expect(404);

    await publish((c) => {
      c.modules.contacts.levels.EXECUTIVE = { view: true, create: false, edit: false, delete: false };
      c.modules.tasks.enabled = false;
    });
    expect((await phone(execToken).post('/contacts', { firstName: 'Ana' }).expect(403)).body.error.code).toBe('MOBILE_ACTION_NOT_ALLOWED');
    await phone(execToken).get('/contacts').expect(200);
    expect((await phone(execToken).get('/tasks').expect(403)).body.error.code).toBe('MOBILE_MODULE_OFF');
    expect((await phone(ownerToken).get('/tasks').expect(403)).body.error.code).toBe('MOBILE_MODULE_OFF');
    await publish(() => {});
  });

  it('adds a contact to a lead and lists the lead’s contacts', async () => {
    const lead = (await phone(execToken).post('/companies', { name: 'Contact Holder' }).expect(201)).body as MobileRecord;
    const c = (await phone(execToken).post('/contacts', { firstName: 'Priya', lastName: 'Shah', company: lead.id, email: 'priya@holder.example' }).expect(201)).body as MobileRecord;
    expect(c).toMatchObject({ firstName: 'Priya', lastName: 'Shah', company: { id: lead.id, name: 'Contact Holder' }, email: 'priya@holder.example' });
    const list = (await phone(execToken).get(`/contacts?companyId=${lead.id}`).expect(200)).body as MobileRecordPage;
    expect(list.items.map((x) => x.id)).toEqual([c.id]);
    expect(((await phone(execToken).patch(`/contacts/${c.id}`, { jobTitle: 'Buyer' }).expect(200)).body as MobileRecord).jobTitle).toBe('Buyer');
  });

  it('plans, completes and cancels follow-ups', async () => {
    const o = (await phone(execToken).get('/options').expect(200)).body as MobileRecordOptions;
    const lead = (await phone(execToken).post('/companies', { name: 'Visit Co' }).expect(201)).body as MobileRecord;
    const soon = new Date(Date.now() + 60 * 60_000).toISOString();
    const f = (await phone(execToken).post('/follow_ups', { title: 'Site visit', company: lead.id, followUpType: o.followUpTypes[0]!.key, dueAt: soon }).expect(201)).body as MobileRecord;
    expect(f).toMatchObject({ title: 'Site visit', company: { id: lead.id }, followUpType: o.followUpTypes[0]!.key, status: expect.any(String) });
    const upcoming = (await phone(execToken).get('/follow_ups?bucket=upcoming&tz=Europe/London').expect(200)).body as MobileRecordPage;
    const today = (await phone(execToken).get('/follow_ups?bucket=today&tz=Europe/London').expect(200)).body as MobileRecordPage;
    expect([...upcoming.items, ...today.items].map((x) => x.id)).toContain(f.id);

    expect((await phone(execToken).patch(`/follow_ups/${f.id}`, { status: 'OPEN' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const done = (await phone(execToken).patch(`/follow_ups/${f.id}`, { status: 'DONE', outcome: 'Met the buyer' }).expect(200)).body as MobileRecord;
    expect(done).toMatchObject({ status: 'DONE', outcome: 'Met the buyer' });
    const completed = (await phone(execToken).get('/follow_ups?bucket=completed').expect(200)).body as MobileRecordPage;
    expect(completed.items.map((x) => x.id)).toContain(f.id);

    const g = (await phone(execToken).post('/follow_ups', { title: 'Call back', company: lead.id, followUpType: o.followUpTypes[0]!.key, dueAt: soon }).expect(201)).body as MobileRecord;
    const canceled = (await phone(execToken).patch(`/follow_ups/${g.id}`, { status: 'CANCELED' }).expect(200)).body as MobileRecord;
    expect(canceled.status).toBe('CANCELED');
  });

  it('adds, edits, finishes and deletes tasks, without follow-ups in the list', async () => {
    const t = (await phone(execToken).post('/tasks', { title: 'Send brochure', priority: 'HIGH' }).expect(201)).body as MobileRecord;
    expect(t).toMatchObject({ title: 'Send brochure', priority: 'HIGH', status: 'OPEN', assignee: { id: exec.userId } });
    const open = (await phone(execToken).get('/tasks').expect(200)).body as MobileRecordPage;
    expect(open.items.map((x) => x.id)).toContain(t.id);
    expect(open.items.every((x) => x.title !== 'Site visit' && x.title !== 'Call back')).toBe(true);
    await phone(execToken).patch(`/tasks/${t.id}`, { status: 'DONE' }).expect(200);
    expect(((await phone(execToken).get('/tasks?status=DONE').expect(200)).body as MobileRecordPage).items.map((x) => x.id)).toContain(t.id);
    expect(((await phone(execToken).get('/tasks?q=brochure').expect(200)).body as MobileRecordPage).items).toEqual([]);
    await phone(execToken).del(`/tasks/${t.id}`, 403);
    const own = (await phone(ownerToken).post('/tasks', { title: 'Owner task' }).expect(201)).body as MobileRecord;
    await phone(ownerToken).del(`/tasks/${own.id}`, 204);
    // A follow-up is not a task.
    const fu = ((await phone(execToken).get('/follow_ups?bucket=completed').expect(200)).body as MobileRecordPage).items[0]!;
    await phone(execToken).get(`/tasks/${fu.id}`).expect(404);
  });

  it('shows the custom fields the configuration allows, and saves them', async () => {
    await api(owner).post('/custom-fields', { entity: 'COMPANY', key: 'visit_notes', label: 'Visit notes', type: 'TEXT' }).expect(201);
    await api(owner).post('/custom-fields', { entity: 'COMPANY', key: 'secret_score', label: 'Secret score', type: 'NUMBER' }).expect(201);
    const all = { view: true, edit: true, create: true, delete: true };
    await publish((c) => {
      c.fields.companies['cf.visit_notes'] = { SUPER: all, MANAGER: all, EXECUTIVE: all };
      c.fields.companies['cf.secret_score'] = { SUPER: all, MANAGER: all, EXECUTIVE: hidden };
    });
    const o = (await phone(execToken).get('/options').expect(200)).body as MobileRecordOptions;
    expect(o.customFields.companies).toEqual([{ key: 'visit_notes', label: 'Visit notes', type: 'TEXT', options: [], edit: true }]);
    const lead = (await phone(execToken).post('/companies', { name: 'Custom Co', customFields: { visit_notes: 'Gate code 42' } }).expect(201)).body as MobileRecord;
    expect(lead.customFields).toEqual({ visit_notes: 'Gate code 42' });
    expect((await phone(execToken).patch(`/companies/${lead.id}`, { customFields: { secret_score: 9 } }).expect(403)).body.error.code).toBe('MOBILE_FIELD_NOT_ALLOWED');
    const ownerView = (await phone(ownerToken).get('/options').expect(200)).body as MobileRecordOptions;
    expect(ownerView.customFields.companies?.map((f) => f.key).sort()).toEqual(['secret_score', 'visit_notes']);
    await publish(() => {});
  });

  it('keeps one person’s records from another workspace', async () => {
    const other = await registerUser(app, 'Other Org');
    const lead = (await api(other).post('/companies', { name: 'Elsewhere Ltd' }).expect(201)).body as { id: string };
    await phone(ownerToken).get(`/companies/${lead.id}`).expect(404);
    await phone(ownerToken).patch(`/companies/${lead.id}`, { city: 'Nowhere' }).expect(404);
  });

  it('is for signed-in people only', async () => {
    await http().get('/api/v1/mobile/records/companies').expect(401);
  });
});
