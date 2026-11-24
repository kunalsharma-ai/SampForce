import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompanyEnrichmentService } from '../src/crm/company-enrichment.service';
import { CompanyLogosService } from '../src/crm/company-logos.service';
import { type LogoFixture, startLogoFixture } from './fixtures/logo-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

/** Company auto-fill from public sources (ADR 0076), through the API, the worker and the stand-in websites. */
describe('company auto-fill', () => {
  let app: INestApplication;
  let fixture: LogoFixture;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let autofill: CompanyEnrichmentService;
  let logos: CompanyLogosService;
  let restore: () => void;

  /** Runs auto-fill until nothing is due (other suites may leave queued runs in the shared test database). */
  const runWorker = async (at = new Date()) => {
    for (let i = 0; i < 50; i++) if (!(await autofill.runDue(at, true))) break;
  };
  const company = async (id: string, user = http) => (await user.get(`/companies/${id}`).expect(200)).body;
  const state = async (id: string) => (await http.get(`/companies/${id}/enrichment`).expect(200)).body;

  beforeAll(async () => {
    fixture = await startLogoFixture();
    restore = setEnv({ LOGO_FIXTURE_URL: fixture.url });
    app = await startApp();
    autofill = app.get(CompanyEnrichmentService);
    logos = app.get(CompanyLogosService);
    owner = await registerUser(app, 'Autofill Org');
    http = api(owner);
  });

  afterAll(async () => {
    await autofill.settle();
    await logos.settle();
    await app.close();
    await fixture.close();
    restore();
  });

  it('fills the missing details of a new company from its website, keeping what was typed', async () => {
    const created = (await http.post('/companies', { name: 'Northwind Insights', website: 'northwind-insights.example', primaryPhone: '+91 99999 00000' }).expect(201)).body;
    expect((await state(created.id)).busy).toBe(true);
    await runWorker();
    const c = await company(created.id);
    expect(c.overview).toMatch(/^Northwind Insights is a global market research company/);
    expect(c.industry).toBe('Market research');
    expect(c.services).toEqual(['Online Surveys', 'B2B Research', 'Healthcare Research', 'Data Processing', 'Panel Management']);
    expect(c.industriesServed).toEqual(['Healthcare', 'Technology', 'Financial Services']);
    expect(c.certifications).toEqual(['ISO 20252:2019', 'ISO 27001', 'ESOMAR member']);
    expect(c.foundedYear).toBe(2009);
    expect(c.employeeCount).toBe(450);
    expect(c.companySize).toBe('201-500');
    expect(c).toMatchObject({ address: '4th Floor, Meridian Tower, 12 Harbour Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001', country: 'IN', timezone: 'Asia/Kolkata', headquarters: 'Pune, India', branchCount: 5 });
    expect(c.addresses).toHaveLength(4);
    expect(c.linkedinUrl).toBe('https://www.linkedin.com/company/northwind-insights');
    expect(c.socialLinks.map((l: { platform: string }) => l.platform).sort()).toEqual(['facebook', 'instagram', 'linkedin', 'x', 'youtube']);
    expect(c.contactPageUrl).toBe('https://www.northwind-insights.example/contact');
    expect(c.primaryEmail).toBe('info@northwind-insights.example');
    expect(c.emails.map((e: { value: string }) => e.value).sort()).toEqual(['bd@northwind-insights.example', 'hr@northwind-insights.example', 'info@northwind-insights.example']);
    // The typed phone stays the primary one; the site's numbers are added beside it.
    expect(c.primaryPhone).toBe('+91 99999 00000');
    expect(c.phones.map((p: { value: string }) => p.value)).toEqual(['+91 99999 00000', '+44 20 7946 0958', '+91 20 4000 1234']);
    // Each value says where it came from.
    expect(c.fieldSources.foundedYear).toMatchObject({ source: 'WEBSITE', url: 'https://www.northwind-insights.example/about-us', confidence: 'medium' });
    expect(c.fieldSources.industry).toMatchObject({ confidence: 'low' });
    expect(c.fieldSources.primaryPhone).toBeUndefined();
    expect(c.fieldSources).not.toHaveProperty('emails.rejected');

    const s = await state(created.id);
    expect(s.busy).toBe(false);
    expect(s.runs[0]).toMatchObject({ status: 'DONE', trigger: 'CREATE', domain: 'northwind-insights.example', requestedBy: { name: expect.any(String) } });
    expect(s.runs[0].sources.map((x: { url: string }) => x.url)).toEqual([
      'https://www.northwind-insights.example/',
      'https://www.northwind-insights.example/about-us',
      'https://www.northwind-insights.example/contact',
    ]);
    expect(s.runs[0].fills.find((f: { field: string }) => f.field === 'foundedYear')).toMatchObject({ display: '2009', source: 'WEBSITE', undone: false });
    // The site was read at the bare domain first, which moved to www.
    expect(fixture.hits).toContain('northwind-insights.example/');
    expect(fixture.hits).toContain('www.northwind-insights.example/about-us');

    // Audit trail.
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, entityId: created.id, action: 'company.auto_filled' } }));
    expect(audit).toHaveLength(1);
    expect((audit[0]!.metadata as { fields: string[] }).fields).toContain('foundedYear');
  });

  it('combines the company’s own data with Wikidata, the company’s statement winning', async () => {
    const created = (await http.post('/companies', { name: 'Globex Analytics', website: 'https://globex-analytics.example' }).expect(201)).body;
    await runWorker();
    const c = await company(created.id);
    expect(c.foundedYear).toBe(1999);
    expect(c.fieldSources.foundedYear).toMatchObject({ source: 'SCHEMA_ORG', confidence: 'high', alternatives: [{ value: '1998', source: 'WIKIDATA', url: 'https://www.wikidata.org/wiki/Q990001' }] });
    expect(c.employeeCount).toBe(11800);
    expect(c).toMatchObject({ legalName: 'Globex Analytics plc', ceo: 'Mateo Lindqvist', parentCompanyName: 'Globex Holdings', companyType: 'Public company', city: 'London', country: 'GB' });
    expect(c.founders).toEqual(['Hana Okafor']);
    expect(c.leadership).toEqual([{ name: 'Mateo Lindqvist', title: 'Chief executive officer' }]);
    expect(c.moreDetails).toEqual([
      { label: 'Slogan', value: 'Know your audience' },
      { label: 'Stock ticker', value: 'London Stock Exchange: GBXA' },
    ]);
    expect(c.fieldSources.ceo).toMatchObject({ source: 'WIKIDATA', url: 'https://www.wikidata.org/wiki/Q990001' });
    // LinkedIn from the site, X from Wikidata: one link per platform.
    expect(c.socialLinks).toEqual([
      { platform: 'linkedin', url: 'https://www.linkedin.com/company/globex-analytics' },
      { platform: 'youtube', url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv' },
      { platform: 'x', url: 'https://x.com/globexanalytics' },
    ]);
    const s = await state(created.id);
    expect(s.runs[0].sources.map((x: { kind: string }) => x.kind)).toContain('WIKIDATA');
  });

  it('finds the website of a company saved with a name only, and then its logo', async () => {
    const created = (await http.post('/companies', { name: 'Umbrella Dynamics' }).expect(201)).body;
    expect(created.logo).toBeNull();
    await runWorker();
    const c = await company(created.id);
    expect(c.website).toBe('https://umbrella-dynamics.example');
    expect(c.domain).toBe('umbrella-dynamics.example');
    expect(c.fieldSources.website).toMatchObject({ source: 'WIKIDATA', confidence: 'medium' });
    expect(c).toMatchObject({ foundedYear: 1984, country: 'DE', industry: 'Manufacturing', primaryEmail: 'sales@umbrella-dynamics.example' });
    expect(c.overview).toMatch(/industrial sensors/);
    // The logo look-up was queued for the website auto-fill found.
    expect(c.logo).toMatchObject({ source: 'AUTO', status: 'PENDING' });
  });

  it('finishes at once when a name-only company is unknown to Wikidata, instead of retrying', async () => {
    const created = (await http.post('/companies', { name: 'Plainfield Works' }).expect(201)).body;
    await runWorker();
    const s = await state(created.id);
    expect(s.busy).toBe(false);
    expect(s.runs[0]).toMatchObject({ status: 'NOTHING_FOUND', error: 'No website, and Wikidata has no company with exactly this name.' });
  });

  it('never writes again what someone changed or cleared, and undoes what they reject', async () => {
    const created = (await http.post('/companies', { name: 'Lumen Harbor', website: 'lumenharbor.example' }).expect(201)).body;
    await runWorker();
    let c = await company(created.id);
    expect(c.foundedYear).toBe(2012);
    expect(c.city).toBe('Manchester');
    const run = (await state(created.id)).runs[0];

    // Someone corrects the industry and clears the founding year.
    await http.patch(`/companies/${created.id}`, { industry: 'Healthcare market research', foundedYear: null }).expect(200);
    c = await company(created.id);
    expect(c.fieldSources.industry).toMatchObject({ source: 'USER', byUserId: expect.any(String) });
    expect(c.fieldSources.foundedYear).toMatchObject({ source: 'USER' });

    // Undo the employee count and the emails the run added.
    const after = (await http.post(`/companies/${created.id}/enrichment/${run.id}/undo`, { fields: ['employeeCount', 'emails', 'primaryEmail'] }).expect(200)).body;
    expect(after.runs[0].fills.filter((f: { undone: boolean }) => f.undone).map((f: { field: string }) => f.field).sort()).toEqual(['emails', 'employeeCount', 'primaryEmail']);
    c = await company(created.id);
    expect(c.employeeCount).toBeNull();
    expect(c.emails).toEqual([]);
    expect(c.primaryEmail).toBeNull();
    expect(c.city).toBe('Manchester');

    // Looking up again changes none of it.
    await asTenant(owner.tenantId, (tx) => tx.companyEnrichment.updateMany({ where: { companyId: created.id }, data: { finishedAt: new Date(Date.now() - 120_000) } }));
    const queued = (await http.post(`/companies/${created.id}/enrich`).expect(202)).body;
    expect(queued.busy).toBe(true);
    await http.post(`/companies/${created.id}/enrich`).expect(409);
    await runWorker();
    c = await company(created.id);
    expect(c.industry).toBe('Healthcare market research');
    expect(c.foundedYear).toBeNull();
    expect(c.employeeCount).toBeNull();
    expect(c.emails).toEqual([]);
    expect((await state(created.id)).runs[0]).toMatchObject({ status: 'NOTHING_FOUND', trigger: 'MANUAL' });
    // And the button waits a minute after a run.
    await http.post(`/companies/${created.id}/enrich`).expect(429);
  });

  it('tries an unreachable site again later, then gives up', async () => {
    const created = (await http.post('/companies', { name: 'Offline Example Co', website: 'offline-co.example' }).expect(201)).body;
    await runWorker();
    let s = await state(created.id);
    expect(s.runs[0]).toMatchObject({ status: 'PENDING', error: 'Could not reach offline-co.example' });
    await runWorker(new Date(Date.now() + 11 * 60_000));
    await runWorker(new Date(Date.now() + 7 * 60 * 60_000));
    s = await state(created.id);
    expect(s.runs[0]).toMatchObject({ status: 'FAILED', error: 'Could not reach offline-co.example' });
    expect((await company(created.id)).overview).toBeNull();
  });

  it('queues imported companies too, spaced out', async () => {
    const csv = 'Company name,Website\nAcme Import Example,acme-import.example\nNo Site Import Ltd,\n';
    await http.post('/imports', { entity: 'companies', csv, autoMap: true }).expect(200);
    const runs = await asTenant(owner.tenantId, (tx) => tx.companyEnrichment.findMany({ where: { tenantId: owner.tenantId, trigger: 'IMPORT' }, orderBy: { nextRunAt: 'asc' } }));
    expect(runs.length).toBe(2);
    expect(runs[1]!.nextRunAt!.getTime() - runs[0]!.nextRunAt!.getTime()).toBeGreaterThanOrEqual(2500);
  });

  it('respects record visibility, permissions, other workspaces and the plan', async () => {
    const created = (await http.post('/companies', { name: 'Private Example', website: 'private.example' }).expect(201)).body;
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).post(`/companies/${created.id}/enrich`).expect(403);
    const other = await registerUser(app, 'Other Autofill Org');
    await api(other).get(`/companies/${created.id}/enrichment`).expect(404);
    await api(other).post(`/companies/${created.id}/enrichment/${created.id}/undo`, {}).expect(404);

    await asTenant(other.tenantId, (tx) => tx.tenantFeatureOverride.create({ data: { tenantId: other.tenantId, feature: 'company_enrichment', enabled: false, reason: 'test', updatedBy: 'test' } }));
    const theirs = (await api(other).post('/companies', { name: 'No Autofill Ltd', website: 'northwind-insights.example' }).expect(201)).body;
    const count = await asTenant(other.tenantId, (tx) => tx.companyEnrichment.count({ where: { companyId: theirs.id } }));
    expect(count).toBe(0);
    await api(other).post(`/companies/${theirs.id}/enrich`).expect(403);
  });
});
