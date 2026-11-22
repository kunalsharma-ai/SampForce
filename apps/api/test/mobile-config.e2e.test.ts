import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { defaultMobileConfig, type MobileAppConfig, type MobileConfigCenter, type MobileConfigResponse } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/**
 * The Mobile Configuration Center (ADR 0072, M2): the Super Workspace edits a draft, publishes versions and rolls
 * back; phones get the published version narrowed to the person's level, plan and role.
 */
describe('mobile configuration', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  const http = () => request(app.getHttpServer());
  const signIn = (u: { email: string; password: string }) =>
    http()
      .post('/api/v1/mobile/auth/login')
      .send({ email: u.email, password: u.password, device: { platform: 'ANDROID', installId: `cfg-${randomUUID().slice(0, 8)}`, model: 'Pixel 10', osVersion: '17', appVersion: '1.0.0' } });
  const phoneGet = (token: string, url: string) => http().get(`/api/v1${url}`).set('authorization', `Bearer ${token}`);
  const copy = (c: MobileAppConfig) => JSON.parse(JSON.stringify(c)) as MobileAppConfig;
  let ownerToken = '';
  let memberToken = '';

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Config Org');
    member = await inviteMember(app, owner, 'member');
    // Approved by the Console and switched on, as M1 tests through the screens.
    await asTenant(owner.tenantId, (tx) => tx.mobileAccess.create({ data: { tenantId: owner.tenantId, status: 'APPROVED', decisionStatus: 'APPROVED', decidedAt: new Date(), activatedAt: new Date(), activatedById: null } }));
    ownerToken = (await signIn(owner).expect(200)).body.accessToken;
    memberToken = (await signIn(member).expect(200)).body.accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts from the default, unpublished, and phones get the default as version 0', async () => {
    const c = (await api(owner).get('/mobile-config').expect(200)).body as MobileConfigCenter;
    expect(c).toMatchObject({ published: null, versions: [], unpublishedChanges: true });
    expect(c.draft).toEqual(defaultMobileConfig());
    const r = (await phoneGet(memberToken, '/mobile/config').expect(200)).body as MobileConfigResponse;
    expect(r).toMatchObject({ version: 0, unchanged: false, config: { level: 'EXECUTIVE' } });
    // Sensitive deal amounts are hidden from Executives by default.
    expect(r.config?.fields.deals?.amount).toBeUndefined();
    expect((await phoneGet(memberToken, '/mobile/session').expect(200)).body.configVersion).toBe(0);
  });

  it('lets only workspace admins see or change the configuration, and only on the web', async () => {
    await api(member).get('/mobile-config').expect(403);
    await api(member).put('/mobile-config/draft', defaultMobileConfig()).expect(403);
    // A phone, even the owner's, cannot reach the Configuration Center.
    expect((await phoneGet(ownerToken, '/mobile-config').expect(403)).body.error.code).toBe('MOBILE_NOT_ALLOWED');
  });

  it('validates the draft and refuses custom fields that do not exist', async () => {
    const bad = copy(defaultMobileConfig());
    bad.branding.primaryColor = 'red';
    expect((await api(owner).put('/mobile-config/draft', bad).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const tooMany = copy(defaultMobileConfig());
    tooMany.navigation.SUPER = ['dashboard', 'companies', 'contacts', 'deals', 'tasks', 'chat'];
    await api(owner).put('/mobile-config/draft', tooMany).expect(400);
    const ghost = copy(defaultMobileConfig());
    ghost.fields.companies['cf.ghost'] = { SUPER: { view: true, edit: true, create: true, delete: true }, MANAGER: { view: true, edit: true, create: true, delete: true }, EXECUTIVE: { view: true, edit: true, create: true, delete: true } };
    const res = await api(owner).put('/mobile-config/draft', ghost).expect(400);
    expect(res.body.error.details[0].path).toBe('fields.companies.cf.ghost');
  });

  it('saves a draft without changing phones, then publishes it as version 1', async () => {
    await api(owner).post('/custom-fields', { entity: 'COMPANY', key: 'visit_notes', label: 'Visit notes', type: 'TEXT' }).expect(201);
    const draft = copy(defaultMobileConfig());
    draft.branding = { ...draft.branding, appName: 'Field Force', primaryColor: '#E11D48' };
    (draft.fields.companies.website as MobileAppConfig['fields']['companies'][string]).EXECUTIVE = { view: false, edit: false, create: false, delete: false };
    draft.fields.companies['cf.visit_notes'] = { SUPER: { view: true, edit: true, create: true, delete: true }, MANAGER: { view: true, edit: true, create: true, delete: true }, EXECUTIVE: { view: true, edit: true, create: true, delete: false } };
    draft.modules.deals.levels.EXECUTIVE = { view: false, create: false, edit: false, delete: false };
    const saved = (await api(owner).put('/mobile-config/draft', draft).expect(200)).body as MobileConfigCenter;
    expect(saved).toMatchObject({ unpublishedChanges: true, published: null, customFields: { companies: [{ key: 'visit_notes', label: 'Visit notes' }] } });
    expect(saved.draft.branding.appName).toBe('Field Force');
    // Phones still get the default until it is published.
    expect((await phoneGet(memberToken, '/mobile/config').expect(200)).body.version).toBe(0);

    const pub = (await api(owner).post('/mobile-config/publish', { note: 'First version for the field team' }).expect(200)).body as MobileConfigCenter;
    expect(pub).toMatchObject({ unpublishedChanges: false, published: { version: 1, note: 'First version for the field team', publishedBy: expect.any(String) } });

    const r = (await phoneGet(memberToken, '/mobile/config').expect(200)).body as MobileConfigResponse;
    expect(r.version).toBe(1);
    expect(r.config?.branding.appName).toBe('Field Force');
    expect(r.config?.fields.companies?.website).toBeUndefined();
    expect(r.config?.fields.companies?.['cf.visit_notes']).toEqual({ edit: true, create: true, delete: false });
    expect(r.config?.modules.map((m) => m.key)).not.toContain('deals');
    expect(r.config?.dashboard.map((d) => d.card)).not.toContain('pipeline_summary');
    // The owner works at Super level and still sees deals and the website.
    const s = (await phoneGet(ownerToken, '/mobile/config').expect(200)).body as MobileConfigResponse;
    expect(s.config).toMatchObject({ level: 'SUPER' });
    expect(s.config?.fields.companies?.website).toBeDefined();
    expect(s.config?.modules.map((m) => m.key)).toContain('deals');
    // A phone that already has version 1 gets nothing new; the session says which version is current.
    expect((await phoneGet(memberToken, '/mobile/config?known=1').expect(200)).body).toEqual({ version: 1, unchanged: true, config: null });
    expect((await phoneGet(memberToken, '/mobile/session').expect(200)).body.configVersion).toBe(1);
    await phoneGet(memberToken, '/mobile/config?known=abc').expect(400);
  });

  it('narrows to the role: a read-only role cannot change records on the phone', async () => {
    const viewer = await inviteMember(app, owner, 'viewer');
    const token = (await signIn(viewer).expect(200)).body.accessToken;
    const r = (await phoneGet(token, '/mobile/config').expect(200)).body as MobileConfigResponse;
    for (const m of r.config?.modules ?? []) expect([m.create, m.edit, m.delete]).toEqual([false, false, false]);
  });

  it('discards a draft back to the published version, and rolls back as a new version', async () => {
    const c = (await api(owner).get('/mobile-config').expect(200)).body as MobileConfigCenter;
    const draft = copy(c.draft);
    draft.branding.appName = 'Second name';
    await api(owner).put('/mobile-config/draft', draft).expect(200);
    const discarded = (await api(owner).del('/mobile-config/draft').expect(200)).body as MobileConfigCenter;
    expect(discarded.draft.branding.appName).toBe('Field Force');
    expect(discarded.unpublishedChanges).toBe(false);

    await api(owner).put('/mobile-config/draft', draft).expect(200);
    await api(owner).post('/mobile-config/publish', {}).expect(200);
    expect((await phoneGet(memberToken, '/mobile/config').expect(200)).body.config.branding.appName).toBe('Second name');

    const back = (await api(owner).post('/mobile-config/rollback', { version: 1 }).expect(200)).body as MobileConfigCenter;
    expect(back.published).toMatchObject({ version: 3, restoredFrom: 1 });
    expect(back.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(back.draft.branding.appName).toBe('Field Force');
    const r = (await phoneGet(memberToken, '/mobile/config?known=2').expect(200)).body as MobileConfigResponse;
    expect(r).toMatchObject({ version: 3, unchanged: false });
    expect(r.config?.branding.appName).toBe('Field Force');
    await api(owner).post('/mobile-config/rollback', { version: 99 }).expect(404);
  });

  it('records every change in the workspace audit log', async () => {
    const rows = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action: { startsWith: 'mobile.config' } }, select: { action: true } }));
    const actions = rows.map((a) => a.action);
    expect(new Set(actions)).toEqual(new Set(['mobile.config_saved', 'mobile.config_published', 'mobile.config_discarded', 'mobile.config_rolled_back']));
  });

  it('is closed when the plan leaves the mobile app out', async () => {
    const other = await registerUser(app, 'No Mobile Org');
    await asTenant(other.tenantId, (tx) => tx.tenantFeatureOverride.create({ data: { tenantId: other.tenantId, feature: 'mobile_app', enabled: false, reason: 'Not in this contract', updatedBy: 'test' } }));
    expect((await api(other).get('/mobile-config').expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
});
