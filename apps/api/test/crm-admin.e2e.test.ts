import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrmRemindersService } from '../src/crm/crm-reminders.service';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

type Def = { id: string; key: string; label: string; type: string; active: boolean; access: { view: boolean; edit: boolean }; position: number };
const cfQuery = (filters: object[]) => `cf=${encodeURIComponent(JSON.stringify(filters))}`;

/** Custom fields and CRM administration (ADR 0062). */
describe('custom fields and CRM administration', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let rep: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  let execDesignation: string;
  let managerDesignation: string;
  let companyId: string;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    http = api(owner);
    rep = await inviteMember(app, owner, 'member');
    manager = await inviteMember(app, owner, 'manager');
    const designations = (await http.get('/crm-config/designations').expect(200)).body as Array<{ id: string; name: string; tier: string }>;
    execDesignation = designations.find((d) => d.name === 'Sales Executive')!.id;
    managerDesignation = designations.find((d) => d.name === 'Sales Manager')!.id;
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    await http.patch(`/tenants/current/members/${mId(rep.userId)}/org`, { designationId: execDesignation, reportingManagerId: manager.userId }).expect(200);
    await http.patch(`/tenants/current/members/${mId(manager.userId)}/org`, { designationId: managerDesignation }).expect(200);
    // Reps see every record here; these tests are about fields, not record visibility.
    const roles = (await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string }>;
    for (const key of ['member', 'manager']) await http.put(`/tenants/current/roles/${roles.find((r) => r.key === key)!.id}/visibility`, { recordScope: 'ALL', viewOthersDetails: true }).expect(200);
    companyId = (await http.post('/companies', { name: 'Acme Panels' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates fields of all fourteen types and checks and coerces every value', async () => {
    const make = async (key: string, type: string, extra: object = {}) => (await http.post('/custom-fields', { entity: 'COMPANY', key, label: key.replace(/_/g, ' '), type, ...extra }).expect(201)).body as Def;
    await make('tier', 'SELECT', { options: ['Gold', 'Silver'], defaultValue: 'Silver', searchable: true });
    await make('notes_long', 'TEXTAREA');
    await make('panel_size', 'NUMBER');
    await make('budget', 'CURRENCY', { currency: 'USD' });
    await make('signed_on', 'DATE');
    await make('kickoff_at', 'DATETIME');
    await make('markets', 'MULTISELECT', { options: ['India', 'UAE', 'UK'] });
    await make('nda', 'CHECKBOX');
    await make('preferred', 'BOOLEAN');
    await make('portal_url', 'URL');
    await make('billing_email', 'EMAIL');
    await make('hotline', 'PHONE');
    await make('vendor_code', 'TEXT', { searchable: true });
    await make('contract_pdf', 'FILE');
    const defs = (await http.get('/custom-fields?entity=COMPANY').expect(200)).body as Def[];
    expect(defs.map((d) => d.type).sort()).toEqual(['BOOLEAN', 'CHECKBOX', 'CURRENCY', 'DATE', 'DATETIME', 'EMAIL', 'FILE', 'MULTISELECT', 'NUMBER', 'PHONE', 'SELECT', 'TEXT', 'TEXTAREA', 'URL']);
    expect(defs.every((d) => d.access.view && d.access.edit)).toBe(true);

    const values = {
      notes_long: 'Long notes', panel_size: '1200', budget: 2500.456, signed_on: '2026-11-01', kickoff_at: '2026-12-01T09:30:00+05:30',
      markets: 'India, UK', nda: 'yes', preferred: false, portal_url: 'portal.acme.example/login', billing_email: 'Billing@Acme.example', hotline: '+91 98765 43210', vendor_code: 'VC-7781',
    };
    const created = (await http.post('/companies', { name: 'Globex Research', customFields: values }).expect(201)).body;
    expect(created.customFields).toEqual({
      tier: 'Silver', notes_long: 'Long notes', panel_size: 1200, budget: { amount: 2500.46, currency: 'USD' }, signed_on: '2026-11-01', kickoff_at: '2026-12-01T04:00:00.000Z',
      markets: ['India', 'UK'], nda: true, preferred: false, portal_url: 'https://portal.acme.example/login', billing_email: 'billing@acme.example', hotline: '+91 98765 43210', vendor_code: 'VC-7781',
    });

    const bad = await http.post('/companies', { name: 'Bad', customFields: { markets: ['Mars'], billing_email: 'not-an-email', portal_url: 'javascript:alert(1)', budget: 'lots', unknown_key: 1 } }).expect(400);
    expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['customFields.billing_email', 'customFields.budget', 'customFields.markets', 'customFields.portal_url', 'customFields.unknown_key']);
  });

  it('edits, reorders, switches off and deletes fields without losing values', async () => {
    const defs = (await http.get('/custom-fields?entity=COMPANY').expect(200)).body as Def[];
    const tier = defs.find((d) => d.key === 'tier')!;
    const renamed = (await http.patch(`/custom-fields/${tier.id}`, { label: 'Account tier', options: ['Gold', 'Silver', 'Bronze'], required: true, description: 'Commercial tier' }).expect(200)).body;
    expect(renamed).toMatchObject({ label: 'Account tier', options: ['Gold', 'Silver', 'Bronze'], required: true, description: 'Commercial tier' });
    // Type and key never change.
    await http.patch(`/custom-fields/${tier.id}`, { type: 'TEXT' }).expect(400);

    const order = [...defs].reverse().map((d) => d.id);
    const reordered = (await http.put('/custom-fields/order', { entity: 'COMPANY', ids: order }).expect(200)).body as Def[];
    expect(reordered.map((d) => d.id)).toEqual(order);
    await http.put('/custom-fields/order', { entity: 'COMPANY', ids: order.slice(1) }).expect(400);

    // Required applies to new saves: a company without a tier gets the default, so it saves.
    const withDefault = (await http.post('/companies', { name: 'Initech' }).expect(201)).body;
    expect(withDefault.customFields.tier).toBe('Silver');
    await http.patch(`/companies/${withDefault.id}`, { customFields: { tier: null } }).expect(400);

    const vendor = defs.find((d) => d.key === 'vendor_code')!;
    const globex = (await http.get('/companies?q=Globex').expect(200)).body.items[0];
    await http.patch(`/custom-fields/${vendor.id}`, { active: false }).expect(200);
    expect((await http.get(`/companies/${globex.id}`).expect(200)).body.customFields.vendor_code).toBeUndefined();
    expect(((await http.get('/custom-fields?entity=COMPANY').expect(200)).body as Def[]).some((d) => d.key === 'vendor_code')).toBe(false);
    const all = (await http.get('/custom-fields?entity=COMPANY&includeInactive=true').expect(200)).body as Def[];
    expect(all.find((d) => d.key === 'vendor_code')!.active).toBe(false);
    await http.patch(`/custom-fields/${vendor.id}`, { active: true }).expect(200);
    expect((await http.get(`/companies/${globex.id}`).expect(200)).body.customFields.vendor_code).toBe('VC-7781');

    const hotline = defs.find((d) => d.key === 'hotline')!;
    await http.del(`/custom-fields/${hotline.id}`).expect(204);
    expect((await http.get(`/companies/${globex.id}`).expect(200)).body.customFields.hotline).toBeUndefined();
    const reuse = await http.post('/custom-fields', { entity: 'COMPANY', key: 'hotline', label: 'Hotline', type: 'PHONE' }).expect(409);
    expect(reuse.body.error.code).toBe('DUPLICATE_KEY');
  });

  it('shows and lets designations edit only the fields they are allowed to', async () => {
    const secret = (await http.post('/custom-fields', { entity: 'COMPANY', key: 'margin_pct', label: 'Margin %', type: 'NUMBER', viewDesignationIds: [managerDesignation] }).expect(201)).body as Def;
    const locked = (await http.post('/custom-fields', { entity: 'COMPANY', key: 'credit_limit', label: 'Credit limit', type: 'NUMBER', editDesignationIds: [managerDesignation] }).expect(201)).body as Def;
    await http.patch(`/companies/${companyId}`, { customFields: { tier: 'Gold', margin_pct: 32, credit_limit: 50000 } }).expect(200);

    const r = api(rep);
    const repDefs = (await r.get('/custom-fields?entity=COMPANY').expect(200)).body as Def[];
    expect(repDefs.some((d) => d.id === secret.id)).toBe(false);
    expect(repDefs.find((d) => d.id === locked.id)!.access).toEqual({ view: true, edit: false });
    const seen = (await r.get(`/companies/${companyId}`).expect(200)).body.customFields;
    expect(seen.margin_pct).toBeUndefined();
    expect(seen.credit_limit).toBe(50000);
    expect((await r.get('/companies?q=Acme').expect(200)).body.items[0].customFields.margin_pct).toBeUndefined();

    // A read-only field can be sent back unchanged, but not changed; a hidden field cannot be written at all.
    await r.patch(`/companies/${companyId}`, { customFields: { credit_limit: 50000, tier: 'Silver' } }).expect(200);
    const refused = await r.patch(`/companies/${companyId}`, { customFields: { credit_limit: 1 } }).expect(403);
    expect(refused.body.error).toMatchObject({ code: 'FIELD_READ_ONLY', details: [{ path: 'customFields', message: 'Credit limit' }] });
    await r.patch(`/companies/${companyId}`, { customFields: { margin_pct: 1 } }).expect(403);
    // Values the rep cannot see survive the rep's edits.
    const m = api(manager);
    const mg = await m.get(`/companies/${companyId}`);
    expect(mg.status, JSON.stringify(mg.body)).toBe(200);
    expect((await m.get(`/companies/${companyId}`).expect(200)).body.customFields).toMatchObject({ margin_pct: 32, credit_limit: 50000, tier: 'Silver' });
    await m.patch(`/companies/${companyId}`, { customFields: { credit_limit: 60000 } }).expect(200);
    // A hidden field cannot be filtered on.
    const f = await r.get(`/companies?${cfQuery([{ key: 'margin_pct', op: 'gte', value: 10 }])}`).expect(400);
    expect(f.body.error.details[0].path).toBe('cf.0.key');
  });

  it('filters lists and finds records by custom fields, within what the person may see', async () => {
    const page = async (filters: object[]) => ((await http.get(`/companies?pageSize=100&${cfQuery(filters)}`).expect(200)).body.items as Array<{ name: string }>).map((c) => c.name).sort();
    expect(await page([{ key: 'markets', op: 'in', value: ['UK'] }])).toEqual(['Globex Research']);
    expect(await page([{ key: 'panel_size', op: 'gte', value: 1000 }, { key: 'nda', op: 'eq', value: true }])).toEqual(['Globex Research']);
    expect(await page([{ key: 'budget', op: 'lte', value: 3000 }])).toEqual(['Globex Research']);
    expect(await page([{ key: 'vendor_code', op: 'contains', value: 'vc-77' }])).toEqual(['Globex Research']);
    expect(await page([{ key: 'tier', op: 'eq', value: 'Silver' }])).toEqual(['Acme Panels', 'Globex Research', 'Initech']);
    expect(await page([{ key: 'signed_on', op: 'unset' }])).toEqual(['Acme Panels', 'Initech']);
    await http.get(`/companies?${cfQuery([{ key: 'nda', op: 'contains', value: 'x' }])}`).expect(400);
    await http.get('/companies?cf=not-json').expect(400);

    const hits = (await http.get('/search?q=VC-7781').expect(200)).body as Array<{ entity: string; title: string; subtitle: string }>;
    expect(hits).toContainEqual(expect.objectContaining({ entity: 'company', title: 'Globex Research', subtitle: 'vendor code: VC-7781' }));
  });

  it('reports on custom fields: group, sum and filter, only with fields the person can see', async () => {
    const run = (definition: object, who = http) => who.post('/reports/run', { definition });
    const byTier = (await run({ entity: 'companies', metric: { fn: 'count' }, groupBy: { field: 'cf.tier' }, chart: 'bar' }).expect(200)).body;
    expect(byTier.groupLabel).toBe('Account tier');
    expect(byTier.rows).toEqual([{ key: 'Silver', label: 'Silver', value: 3 }]);
    const panels = (await run({ entity: 'companies', metric: { fn: 'sum', field: 'cf.panel_size' }, filters: [{ field: 'cf.markets', op: 'eq', value: 'UK' }] }).expect(200)).body;
    expect(panels.total).toBe(1200);
    const none = (await run({ entity: 'companies', metric: { fn: 'count' }, filters: [{ field: 'cf.markets', op: 'in', value: ['UAE'] }] }).expect(200)).body;
    expect(none.total).toBe(0);
    const signed = (await run({ entity: 'companies', metric: { fn: 'count' }, groupBy: { field: 'cf.signed_on', bucket: 'month' }, chart: 'line', sort: 'label_asc' }).expect(200)).body;
    expect(signed.rows.find((r: { key: string | null }) => r.key === '2026-11-01')).toMatchObject({ value: 1 });
    const flagged = (await run({ entity: 'companies', metric: { fn: 'count' }, filters: [{ field: 'cf.nda', op: 'eq', value: true }, { field: 'cf.kickoff_at', op: 'gte', value: '2026-11-15' }] }).expect(200)).body;
    expect(flagged.total).toBe(1);

    // Unknown fields, wrong operators and fields the person cannot see are refused, also when saving.
    expect((await run({ entity: 'companies', metric: { fn: 'count' }, groupBy: { field: 'cf.nope' } }).expect(400)).body.error.details[0].path).toBe('definition.groupBy.field');
    await run({ entity: 'companies', metric: { fn: 'sum', field: 'cf.tier' } }).expect(400);
    await run({ entity: 'companies', metric: { fn: 'count' }, filters: [{ field: 'cf.nda', op: 'contains', value: 'x' }] }).expect(400);
    await run({ entity: 'companies', metric: { fn: 'count' }, groupBy: { field: 'cf.contract_pdf' } }).expect(400);
    await run({ entity: 'companies', metric: { fn: 'avg', field: 'cf.margin_pct' } }).expect(200);
    await run({ entity: 'companies', metric: { fn: 'avg', field: 'cf.margin_pct' } }, api(rep)).expect(400);
    await api(rep).post('/reports', { name: 'Margins', visibility: 'PRIVATE', definition: { entity: 'companies', metric: { fn: 'avg', field: 'cf.margin_pct' } } }).expect(400);
    const saved = (await http.post('/reports', { name: 'Companies by tier', visibility: 'WORKSPACE', definition: { entity: 'companies', metric: { fn: 'count' }, groupBy: { field: 'cf.tier' }, chart: 'pie' } }).expect(201)).body;
    expect((await api(rep).get(`/reports/${saved.id}/result`).expect(200)).body.total).toBe(3);
  });

  it('keeps files in FILE fields with the record, and downloads them only for people who can see it', async () => {
    const up = await owner.agent.post('/api/v1/custom-fields/files?entity=COMPANY&key=contract_pdf&name=msa.pdf').set('origin', ORIGIN).set('content-type', 'application/pdf').send(Buffer.from('%PDF-1.4 test')).expect(201);
    const file = up.body as { id: string; name: string; size: number };
    expect(file).toMatchObject({ name: 'msa.pdf', size: 13 });
    // Another person cannot download an upload nobody saved yet, nor put it in a record.
    await api(rep).get(`/custom-fields/files/${file.id}`).expect(404);
    await api(rep).patch(`/companies/${companyId}`, { customFields: { contract_pdf: [file.id] } }).expect(400);
    const saved = (await http.patch(`/companies/${companyId}`, { customFields: { contract_pdf: [file.id] } }).expect(200)).body;
    expect(saved.customFields.contract_pdf).toEqual([{ id: file.id, name: 'msa.pdf', size: 13, contentType: 'application/pdf' }]);
    const dl = await api(rep).get(`/custom-fields/files/${file.id}`).expect(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    // Clearing the value deletes the file.
    await http.patch(`/companies/${companyId}`, { customFields: { contract_pdf: null } }).expect(200);
    await http.get(`/custom-fields/files/${file.id}`).expect(404);
  });

  it('adds fields to follow-ups and RFQs, with follow-up categories and RFQ status labels from the configuration', async () => {
    await http.post('/custom-fields', { entity: 'FOLLOW_UP', key: 'agenda', label: 'Agenda', type: 'TEXTAREA', required: true }).expect(201);
    await http.post('/custom-fields', { entity: 'RFQ', key: 'panel', label: 'Panel', type: 'SELECT', options: ['B2B', 'B2C'] }).expect(201);
    const site = (await http.post('/crm-config/options/FOLLOW_UP_TYPE', { label: 'Site visit', color: '#f97316' }).expect(201)).body;
    expect(site).toMatchObject({ value: 'C_SITE_VISIT', builtIn: false, active: true });

    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const noAgenda = await http.post('/follow-ups', { companyId, type: 'C_SITE_VISIT', title: 'Visit the plant', dueAt: due }).expect(400);
    expect(noAgenda.body.error.details[0].path).toBe('customFields.agenda');
    const fu = (await http.post('/follow-ups', { companyId, type: 'C_SITE_VISIT', title: 'Visit the plant', dueAt: due, customFields: { agenda: 'Tour and capability review' } }).expect(201)).body;
    expect(fu).toMatchObject({ type: 'C_SITE_VISIT', customFields: { agenda: 'Tour and capability review' } });
    await http.post('/follow-ups', { companyId, type: 'C_NOT_A_CATEGORY', title: 'x', dueAt: due, customFields: { agenda: 'a' } }).expect(400);

    // A switched-off category cannot be picked for new follow-ups; existing ones keep it, and it cannot be deleted while used.
    await http.put('/crm-config/options/FOLLOW_UP_TYPE/C_SITE_VISIT', { active: false }).expect(200);
    const off = await http.post('/follow-ups', { companyId, type: 'C_SITE_VISIT', title: 'Again', dueAt: due, customFields: { agenda: 'a' } }).expect(400);
    expect(off.body.error.details[0]).toMatchObject({ path: 'type', message: 'is switched off in CRM configuration' });
    await http.patch(`/follow-ups/${fu.id}`, { title: 'Visit the plant in Pune' }).expect(200);
    await http.del('/crm-config/options/FOLLOW_UP_TYPE/C_SITE_VISIT').expect(409);
    const options = (await http.get('/crm-config/options?kind=FOLLOW_UP_TYPE').expect(200)).body as Array<{ value: string; used: number }>;
    expect(options.find((o) => o.value === 'C_SITE_VISIT')!.used).toBe(1);

    // RFQ statuses: renamed and recoloured; a hidden one cannot be chosen; Won cannot be hidden.
    await http.put('/crm-config/options/RFQ_STATUS/PRICING', { label: 'Costing', color: '#123456' }).expect(200);
    await http.put('/crm-config/options/RFQ_STATUS/ON_HOLD', { active: false }).expect(200);
    await http.put('/crm-config/options/RFQ_STATUS/WON', { active: false }).expect(400);
    const rfqStatuses = (await http.get('/crm-config/options?kind=RFQ_STATUS').expect(200)).body as Array<{ value: string; label: string; color: string; active: boolean }>;
    expect(rfqStatuses.find((s) => s.value === 'PRICING')).toMatchObject({ label: 'Costing', color: '#123456', active: true });
    await http.post('/rfqs', { companyId, projectName: 'Paused study', status: 'ON_HOLD' }).expect(400);
    const rfq = (await http.post('/rfqs', { companyId, projectName: 'India B2B tracker', sampleSize: 400, cpi: 12, customFields: { panel: 'B2B' } }).expect(201)).body;
    expect(rfq.customFields).toEqual({ panel: 'B2B' });
    const filtered = (await http.get(`/rfqs?${cfQuery([{ key: 'panel', op: 'eq', value: 'B2B' }])}`).expect(200)).body;
    expect(filtered.items.map((r: { id: string }) => r.id)).toEqual([rfq.id]);
    const found = (await http.get(`/search?q=${rfq.number}`).expect(200)).body as Array<{ entity: string; id: string }>;
    expect(found).toContainEqual(expect.objectContaining({ entity: 'rfq', id: rfq.id }));

    // Reordering lists every option once.
    const order = rfqStatuses.map((s) => s.value).reverse();
    const reordered = (await http.put('/crm-config/options/order', { kind: 'RFQ_STATUS', values: order }).expect(200)).body as Array<{ value: string }>;
    expect(reordered.map((s) => s.value)).toEqual(order);
  });

  it('exports visible custom fields as CSV and Excel, under each role’s export permissions', async () => {
    const csv = await http.get('/exports/companies').expect(200);
    const [header, ...lines] = (csv.text as string).trim().split(/\r?\n/);
    expect(header).toContain('markets');
    expect(lines.find((l) => l.includes('Globex Research'))).toContain('"India, UK"');
    const xlsx = await http.get('/exports/rfqs?format=xlsx').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(xlsx.headers['content-type'], (xlsx.body as Buffer).toString().slice(0, 300)).toContain('spreadsheetml');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    // The manager role may export companies as CSV only, without contact details; deals are refused.
    // Managers do not export by default, so this workspace gives them a custom role that may.
    const roles = (await http.get('/tenants/current/roles').expect(200)).body as Array<{ id: string; key: string; permissions: string[] }>;
    const base = roles.find((r) => r.key === 'manager')!;
    const exporter = (await http.post('/tenants/current/roles', { name: 'Exporting manager', permissions: [...base.permissions, 'data:export'] }).expect(201)).body as { id: string; key: string };
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    await http.patch(`/tenants/current/members/${members.find((x) => x.userId === manager.userId)!.membershipId}/role`, { roleKey: exporter.key }).expect(200);
    const managerRole = exporter.id;
    await http.put('/crm-config/export-policy', { roles: [{ roleId: managerRole, entities: ['companies'], formats: ['csv'], withoutContactDetails: true }] }).expect(200);
    const policy = (await http.get('/crm-config/export-policy').expect(200)).body as Array<{ roleId: string; isDefault: boolean; hasExportPermission: boolean }>;
    expect(policy.find((p) => p.roleId === managerRole)).toMatchObject({ isDefault: false, hasExportPermission: true });
    const m = api(manager);
    await m.get('/exports/companies?format=xlsx').expect(403);
    await m.get('/exports/deals').expect(403);
    await http.patch(`/companies/${companyId}`, { primaryEmail: 'sales@acmepanels.example' }).expect(200);
    const managerCsv = (await m.get('/exports/companies').expect(200)).text as string;
    expect(managerCsv).not.toContain('sales@acmepanels.example');
    // Fields hidden from the manager's designation are not exported for them either.
    expect(managerCsv).toContain('Margin %');
    expect((await api(rep).get('/exports/companies').expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it('switches notification categories off and sends follow-up and RFQ deadline reminders once', async () => {
    const reminders = app.get(CrmRemindersService);
    const settings = (await http.get('/crm-config/notifications').expect(200)).body;
    expect(settings).toEqual({ disabled: [], reminders: { followUpBeforeMinutes: 60, followUpOverdue: true, overdueNotifiesManager: true, rfqDeadlineDays: 2 } });

    // RFQ assignment notifications off: the rep gets none for a new RFQ.
    await http.put('/crm-config/notifications', { ...settings, disabled: ['rfqs'] }).expect(200);
    await http.post('/rfqs', { companyId, projectName: 'Silent RFQ', ownerId: rep.userId }).expect(201);
    const inbox = async (who: TestUser) => ((await api(who).get('/notifications').expect(200)).body.items as Array<{ type: string; title: string }>);
    expect((await inbox(rep)).some((n) => n.type === 'rfq.assigned')).toBe(false);
    await http.put('/crm-config/notifications', settings).expect(200);

    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    await http.post('/follow-ups', { companyId, type: 'CALL', title: 'Call Priya back', dueAt: soon, assigneeId: rep.userId, customFields: { agenda: 'Pricing' } }).expect(201);
    await http.post('/follow-ups', { companyId, type: 'EMAIL', title: 'Send the revised quote', dueAt: past, assigneeId: rep.userId, managerId: manager.userId, customFields: { agenda: 'Quote' } }).expect(201);
    await http.post('/rfqs', { companyId, projectName: 'UAE healthcare study', ownerId: rep.userId, deadlineAt: new Date(Date.now() + 20 * 3_600_000).toISOString() }).expect(201);

    await reminders.sweep();
    await reminders.sweep();
    const repInbox = await inbox(rep);
    expect(repInbox.filter((n) => n.type === 'followup.reminder').map((n) => n.title)).toEqual(['Follow-up due soon: Call Priya back']);
    expect(repInbox.filter((n) => n.type === 'followup.overdue').map((n) => n.title)).toEqual(['Follow-up overdue: Send the revised quote']);
    expect(repInbox.filter((n) => n.type === 'rfq.deadline').map((n) => n.title)).toEqual([expect.stringMatching(/^RFQ deadline tomorrow: RFQ-\d{4} UAE healthcare study$/)]);
    expect((await inbox(manager)).filter((n) => n.type === 'followup.overdue')).toHaveLength(1);

    // A new due date gets a new reminder.
    const fu = (await http.get(`/follow-ups?companyId=${companyId}&bucket=overdue&scope=all`).expect(200)).body.find((f: { title: string }) => f.title === 'Send the revised quote');
    await http.post(`/follow-ups/${fu.id}/reschedule`, { dueAt: new Date(Date.now() + 10 * 60_000).toISOString(), reason: 'Client asked' }).expect(200);
    await reminders.sweep();
    expect((await inbox(rep)).filter((n) => n.title === 'Follow-up due soon: Send the revised quote')).toHaveLength(1);

    // Arabic readers see the reminder in Arabic.
    const ar = (await rep.agent.get('/api/v1/notifications').set('accept-language', 'ar').expect(200)).body.items as Array<{ type: string; title: string }>;
    expect(ar.find((n) => n.type === 'followup.overdue')!.title).toBe('متابعة متأخرة: Send the revised quote');
  });

  it('keeps the base currency, enabled currencies and exchange rates', async () => {
    await http.post('/rfqs', { companyId, projectName: 'Euro tracker', currency: 'EUR' }).expect(201);
    const before = (await http.get('/crm-config/currency').expect(200)).body;
    expect(before).toMatchObject({ baseCurrency: 'USD', missingRates: ['EUR'] });
    const set = (await http.put('/crm-config/currency', { baseCurrency: 'USD', enabled: ['EUR', 'INR', 'AED'] }).expect(200)).body;
    expect(set.enabled).toEqual(['USD', 'EUR', 'INR', 'AED']);
    const rated = (await http.post('/crm-config/currency/rates', { currency: 'EUR', rate: 1.08, effectiveDate: '2026-11-01' }).expect(201)).body;
    expect(rated).toMatchObject({ rates: [{ currency: 'EUR', rate: 1.08, effectiveDate: '2026-11-01' }], missingRates: [] });
    await http.post('/crm-config/currency/rates', { currency: 'USD', rate: 1, effectiveDate: '2026-11-01' }).expect(400);
    // Reps read the currencies (for pickers) but cannot change them.
    expect((await api(rep).get('/crm-config/currency').expect(200)).body.enabled).toContain('INR');
    await api(rep).put('/crm-config/currency', { baseCurrency: 'INR', enabled: [] }).expect(403);
    expect((await http.del('/crm-config/currency/rates/EUR').expect(200)).body.missingRates).toEqual(['EUR']);
  });

  it('limits dashboard widgets per designation tier and can lock the layout', async () => {
    await http.put('/crm-config/dashboards', { tier: 'EXECUTIVE', allowedWidgets: ['kpis', 'pipeline', 'exec.kpis', 'exec.work'], defaultLayout: [{ id: 'exec.work', size: 'full' }, { id: 'exec.kpis', size: 'full' }], canCustomize: false }).expect(200);
    const policies = (await http.get('/crm-config/dashboards').expect(200)).body as Array<{ tier: string; canCustomize: boolean }>;
    expect(policies.map((p) => p.tier)).toEqual(['EXECUTIVE', 'MANAGER', 'SENIOR']);
    const r = api(rep);
    const layout = (await r.get('/me/dashboard-layout').expect(200)).body;
    expect(layout.policy).toEqual({ tier: 'EXECUTIVE', allowed: ['kpis', 'pipeline'], locked: true });
    const saved = await r.put('/me/dashboard-layout', { preset: 'custom', widgets: [{ id: 'kpis', size: 'full', hidden: false }], filters: { period: '30d' } }).expect(403);
    expect(saved.body.error.code).toBe('LAYOUT_LOCKED');
    // Managers are not limited by the executive policy.
    expect((await api(manager).get('/me/dashboard-layout').expect(200)).body.policy).toEqual({ tier: 'MANAGER', allowed: expect.arrayContaining(['kpis', 'team', 'risk']), locked: false });
    await r.put('/crm-config/dashboards', { tier: 'EXECUTIVE', allowedWidgets: null, defaultLayout: null, canCustomize: true }).expect(403);
  });

  it('saves the revenue attribution rule', async () => {
    expect((await http.get('/crm-config/attribution').expect(200)).body).toMatchObject({ model: 'DEAL_CLOSURE', closerPct: 100 });
    const shared = (await http.put('/crm-config/attribution', { model: 'SHARED', leadCreatorPct: 30, closerPct: 50, accountOwnerPct: 20, supportersPct: 0 }).expect(200)).body;
    expect(shared).toMatchObject({ model: 'SHARED', leadCreatorPct: 30, closerPct: 50 });
    await http.put('/crm-config/attribution', { model: 'SHARED', leadCreatorPct: 30, closerPct: 30, accountOwnerPct: 20, supportersPct: 0 }).expect(400);
    await api(rep).get('/crm-config/attribution').expect(403);
  });

  it('shows conditional fields only when their condition holds, and calculates formula fields', async () => {
    const make = (body: object) => http.post('/custom-fields', { entity: 'CONTACT', ...body });
    const ok = async (body: object) => (await make(body).expect(201)).body as Def & { showWhen: unknown; formula: string | null };
    await ok({ key: 'is_panelist', label: 'Panelist', type: 'BOOLEAN' });
    const panelName = await ok({ key: 'panel_name', label: 'Panel name', type: 'TEXT', required: true, showWhen: { key: 'is_panelist', op: 'eq', value: true } });
    expect(panelName.showWhen).toEqual({ key: 'is_panelist', op: 'eq', value: true });
    await ok({ key: 'sample_size', label: 'Sample size', type: 'NUMBER' });
    await ok({ key: 'cpi', label: 'CPI', type: 'CURRENCY', currency: 'USD' });
    const value = await ok({ key: 'project_value', label: 'Project value', type: 'FORMULA', formula: '{sample_size} * {cpi}', decimals: 2, currency: 'USD' });
    expect(value).toMatchObject({ formula: '{sample_size} * {cpi}', access: { view: true, edit: false } });
    const perComplete = await ok({ key: 'per_complete', label: 'Per complete', type: 'FORMULA', formula: '{project_value} / {sample_size}', decimals: 3, showWhen: { key: 'project_value', op: 'gte', value: 100 } });

    // Formulas and conditions that cannot work are refused with the reason.
    const detail = async (body: object) => ((await make(body).expect(400)).body.error.details[0] as { path: string; message: string });
    expect(await detail({ key: 'broken', label: 'Broken', type: 'FORMULA', formula: '{sample_size} *' })).toEqual({ path: 'formula', message: 'The formula ends too early' });
    expect((await detail({ key: 'broken', label: 'Broken', type: 'FORMULA', formula: '{nope} + 1' })).message).toBe('{nope} is not a field of this record type');
    expect((await detail({ key: 'broken', label: 'Broken', type: 'FORMULA', formula: '{panel_name} + 1' })).message).toBe('Panel name is not a number, currency or formula field');
    expect((await detail({ key: 'broken', label: 'Broken', type: 'TEXT', showWhen: { key: 'nope', op: 'set' } })).path).toBe('showWhen.key');
    expect((await detail({ key: 'broken', label: 'Broken', type: 'TEXT', showWhen: { key: 'is_panelist', op: 'contains', value: 'x' } })).path).toBe('showWhen.op');
    expect((await http.patch(`/custom-fields/${value.id}`, { formula: '{per_complete} * 2' }).expect(400)).body.error.details[0].message).toBe('This formula would use itself');
    const panelist = (await http.get('/custom-fields?entity=CONTACT').expect(200)).body.find((d: Def) => d.key === 'is_panelist') as Def;
    expect((await http.patch(`/custom-fields/${panelist.id}`, { showWhen: { key: 'panel_name', op: 'set' } }).expect(400)).body.error.details[0].message).toBe('These conditions would depend on each other in a loop');
    // A field others depend on cannot be deleted while they do.
    const size = (await http.get('/custom-fields?entity=CONTACT').expect(200)).body.find((d: Def) => d.key === 'sample_size') as Def;
    expect((await http.del(`/custom-fields/${size.id}`).expect(409)).body.error.code).toBe('FIELD_IN_USE');

    // A hidden field is not required; formula values are calculated, whatever the form sends.
    const plain = (await http.post('/contacts', { firstName: 'Asha', lastName: 'Rao', companyId, customFields: { sample_size: 400, cpi: 2.5, project_value: 5 } }).expect(201)).body;
    expect(plain.customFields).toEqual({ sample_size: 400, cpi: { amount: 2.5, currency: 'USD' }, project_value: 1000, per_complete: 2.5 });
    expect((await http.post('/contacts', { firstName: 'Ben', lastName: 'Ng', companyId, customFields: { is_panelist: true } }).expect(400)).body.error.details).toEqual([{ path: 'customFields.panel_name', message: 'Panel name is required' }]);
    const shown = (await http.post('/contacts', { firstName: 'Ben', lastName: 'Ng', companyId, customFields: { is_panelist: true, panel_name: 'B2B India', sample_size: 20, cpi: 3 } }).expect(201)).body;
    expect(shown.customFields).toEqual({ is_panelist: true, panel_name: 'B2B India', sample_size: 20, cpi: { amount: 3, currency: 'USD' }, project_value: 60 });
    // When the condition stops holding, the hidden value goes.
    const patched = (await http.patch(`/contacts/${shown.id}`, { customFields: { is_panelist: false } }).expect(200)).body;
    expect(patched.customFields).toEqual({ is_panelist: false, sample_size: 20, cpi: { amount: 3, currency: 'USD' }, project_value: 60 });

    // Formula values are stored, so list filters and reports use them; changing a formula recalculates every record.
    const names = async (filters: object[]) => ((await http.get(`/contacts?pageSize=100&${cfQuery(filters)}`).expect(200)).body.items as Array<{ firstName: string }>).map((c) => c.firstName);
    expect(await names([{ key: 'project_value', op: 'gte', value: 500 }])).toEqual(['Asha']);
    await http.patch(`/custom-fields/${value.id}`, { formula: '{sample_size} * {cpi} * 10' }).expect(200);
    expect((await http.get(`/contacts/${plain.id}`).expect(200)).body.customFields).toMatchObject({ project_value: 10000, per_complete: 25 });
    expect((await http.get(`/contacts/${shown.id}`).expect(200)).body.customFields).toMatchObject({ project_value: 600, per_complete: 30 });
    const sum = (await http.post('/reports/run', { definition: { entity: 'contacts', metric: { fn: 'sum', field: 'cf.project_value' } } }).expect(200)).body;
    expect(sum.total).toBe(10600);
    // Formula fields cannot be typed into, and their condition still applies.
    await http.patch(`/custom-fields/${perComplete.id}`, { showWhen: { key: 'project_value', op: 'gte', value: 1000 } }).expect(200);
    expect((await http.get(`/contacts/${shown.id}`).expect(200)).body.customFields.per_complete).toBeUndefined();
    expect((await http.get(`/contacts/${plain.id}`).expect(200)).body.customFields.per_complete).toBe(25);
  });

  it('keeps basic fields on every plan and the rest behind advanced custom fields and Excel export', async () => {
    const free = await registerUser(app, 'Free Co', { plan: 'free' });
    const f = api(free);
    await f.post('/custom-fields', { entity: 'COMPANY', key: 'region', label: 'Region', type: 'SELECT', options: ['North', 'South'] }).expect(201);
    const multi = await f.post('/custom-fields', { entity: 'COMPANY', key: 'regions', label: 'Regions', type: 'MULTISELECT', options: ['North'] }).expect(403);
    expect(multi.body.error).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', details: [{ message: 'custom_fields_advanced' }] });
    await f.post('/custom-fields', { entity: 'RFQ', key: 'panel', label: 'Panel', type: 'TEXT' }).expect(403);
    expect((await f.get('/exports/companies?format=xlsx').expect(403)).body.error.details[0].message).toBe('excel_export');
    await f.get('/exports/companies').expect(200);
    // Another workspace never sees these fields.
    expect(((await f.get('/custom-fields').expect(200)).body as Def[]).map((d) => d.key)).toEqual(['region']);
    await asTenant(free.tenantId, async (tx) => expect(await tx.customField.count({ where: { tenantId: owner.tenantId } })).toBe(0));
  });
});
