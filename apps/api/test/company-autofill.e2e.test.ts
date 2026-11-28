import type { INestApplication } from '@nestjs/common';
import type { FoundPerson } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_ENV, type ApiEnv } from '../src/common/env';
import { CompanyEnrichmentService } from '../src/crm/company-enrichment.service';
import { CompanyLogosService } from '../src/crm/company-logos.service';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { startFinderFixture } from './fixtures/finder-fixture';
import { type LogoFixture, startLogoFixture } from './fixtures/logo-fixture';
import { api, asTenant, inviteMember, ownerClient, registerUser, startApp, type TestUser } from './helpers';

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
  let ai: AiFixture;
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
    ai = await createAiFixture();
    restore = setEnv({ LOGO_FIXTURE_URL: fixture.url, ANTHROPIC_API_KEY: 'test-key-not-real', AI_API_BASE_URL: ai.url });
    app = await startApp();
    autofill = app.get(CompanyEnrichmentService);
    logos = app.get(CompanyLogosService);
    owner = await registerUser(app, 'Autofill Org');
    http = api(owner);
    // Other suites share this database and leave auto-fill runs queued for companies with made-up websites. The
    // worker here would pick them up first and wait up to a minute on each, timing the first test out in CI, so
    // they are closed before this suite starts.
    const db = ownerClient();
    await db.companyEnrichment.updateMany({ where: { status: 'PENDING', tenantId: { not: owner.tenantId } }, data: { status: 'FAILED', error: 'Closed by the auto-fill test suite.' } });
    await db.$disconnect();
  });

  afterAll(async () => {
    await autofill.settle();
    await logos.settle();
    await app.close();
    await fixture.close();
    await ai.close();
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

  it('writes an AI summary from Business Information only, saved and labelled with its time', async () => {
    const created = (await http.post('/companies', { name: 'Summary Co', industry: 'Market research', country: 'IN', city: 'Pune', foundedYear: 2009, services: ['Online Surveys'] }).expect(201)).body;
    const res = (await http.post(`/companies/${created.id}/ai-summary`).expect(200)).body;
    expect(res.aiSummary).toBe('Summary Co works in Market research, based in Pune, IN. It was founded in 2009. Its services include Online Surveys.');
    const c = await company(created.id);
    expect(c.aiSummary).toBe(res.aiSummary);
    expect(c.aiSummaryAt).toBe(res.aiSummaryAt);
    // Nothing else on the company changed.
    expect(c.overview).toBeNull();
    const run = await asTenant(owner.tenantId, (tx) => tx.aiRun.findFirst({ where: { agent: 'company_summary', entityId: created.id } }));
    expect(run).toMatchObject({ status: 'SUCCEEDED', entityType: 'company' });
  });

  it('looks a company up before it is saved, without storing anything, and limits how often', async () => {
    const before = await asTenant(owner.tenantId, (tx) => tx.company.count());
    const res = (await http.post('/companies/autofill-preview', { name: 'Northwind Insights', website: 'https://northwind-insights.example' }).expect(200)).body;
    const byField = Object.fromEntries(res.found.map((f: { field: string; value: unknown }) => [f.field, f.value]));
    expect(byField).toMatchObject({ foundedYear: 2009, city: 'Pune', country: 'IN', primaryEmail: 'info@northwind-insights.example', industry: 'Market research' });
    expect(res.found.find((f: { field: string }) => f.field === 'foundedYear')).toMatchObject({ source: 'WEBSITE', url: 'https://www.northwind-insights.example/about-us', confidence: 'medium' });
    expect(res.found.some((f: { field: string }) => f.field === 'website')).toBe(false);
    expect(res.sources[0]).toMatchObject({ kind: 'WEBSITE' });
    expect(await asTenant(owner.tenantId, (tx) => tx.company.count())).toBe(before);
    // An unreachable site says so.
    const off = (await http.post('/companies/autofill-preview', { name: 'Offline Co', website: 'offline-co.example' }).expect(200)).body;
    expect(off).toMatchObject({ found: [], error: 'Could not reach offline-co.example' });
    // A few look-ups a minute per person.
    for (let i = 0; i < 4; i++) await http.post('/companies/autofill-preview', { name: 'Offline Co', website: 'offline-co.example' }).expect(200);
    await http.post('/companies/autofill-preview', { name: 'Offline Co', website: 'offline-co.example' }).expect(429);
    // Six look-ups, each trying the site in a plain request and then in the hidden browser, can pass 20 seconds on a
    // busy CI runner.
  }, 60_000);

  describe('sites that hide their details (ADR 0079)', () => {
    let finder: ReturnType<typeof api>;
    beforeAll(async () => {
      // Previews are limited per person, so these use their own person.
      finder = api(await registerUser(app, 'Autofill Finder Org'));
    });
    const preview = async (name: string, website: string) => {
      const res = (await finder.post('/companies/autofill-preview', { name, website }).expect(200)).body as { found: { field: string; value: unknown; url: string | null }[]; sources: { url: string }[]; people: FoundPerson[] };
      return { ...res, by: Object.fromEntries(res.found.map((f) => [f.field, f.value])) as Record<string, unknown> };
    };

    it('opens a site built by JavaScript in the hidden browser and reads what it draws', async () => {
      const r = await preview('BrightSignal', 'https://brightsignal.example');
      expect(r.by).toMatchObject({
        primaryEmail: 'contact@brightsignal.example',
        primaryPhone: '+1 415 555 0132',
        linkedinUrl: 'https://www.linkedin.com/company/brightsignal-insights',
        foundedYear: 2016,
        city: 'San Francisco',
        country: 'US',
        services: ['Concept testing', 'Brand tracking', 'Shopper research'],
      });
      // About and Contact answer 404 to a plain request; in the browser they draw, so they are read.
      expect(r.sources.map((s) => s.url)).toEqual(expect.arrayContaining(['https://brightsignal.example/', 'https://brightsignal.example/about', 'https://brightsignal.example/contact']));
      // The page's own request for its data went through the server too.
      expect(fixture.hits).toContain('brightsignal.example/api/site.json');
      // The "Meet the team" section the browser drew: name, designation, email and LinkedIn as the page shows them.
      expect(r.people).toEqual([
        { name: 'Maya Okonkwo', title: 'Founder & CEO', email: 'maya.okonkwo@brightsignal.example', linkedinUrl: 'https://www.linkedin.com/in/maya-okonkwo-example', source: 'WEBSITE', url: 'https://brightsignal.example/about' },
        { name: 'Daniel Reyes', title: 'Head of Research', email: 'daniel.reyes@brightsignal.example', linkedinUrl: 'https://www.linkedin.com/in/daniel-reyes-example', source: 'WEBSITE', url: 'https://brightsignal.example/about' },
        { name: 'Aisha Rahman', title: 'Senior Project Manager', email: null, linkedinUrl: 'https://www.linkedin.com/in/aisha-rahman-example', source: 'WEBSITE', url: 'https://brightsignal.example/about' },
      ]);
    });

    it('reads only the empty shell with the browser switched off', async () => {
      // The console switch (ADR 0053 settings are read live from the environment object).
      const env = app.get<ApiEnv>(API_ENV);
      env.COMPANY_AUTOFILL_BROWSER = false;
      try {
        const r = await preview('BrightSignal', 'https://brightsignal.example');
        expect(r.by.primaryEmail).toBeUndefined();
        expect(r.by.primaryPhone).toBeUndefined();
      } finally {
        env.COMPANY_AUTOFILL_BROWSER = undefined;
      }
    });

    it('reads the business sub-site and its contact page when the home page is for consumers', async () => {
      const r = await preview('Pollpocket', 'https://pollpocket.example');
      expect(r.sources.map((s) => s.url)).toEqual(['https://pollpocket.example/', 'https://business.pollpocket.example/', 'https://business.pollpocket.example/contact-us']);
      expect(r.by).toMatchObject({ primaryEmail: 'sales@pollpocket.example', city: 'Pune', state: 'Maharashtra', postalCode: '411014', country: 'IN', foundedYear: 2015 });
      // Phones shown without a label, and the US office written over two lines without its country.
      expect((r.by.phones as { value: string }[]).map((p) => p.value)).toEqual(expect.arrayContaining(['+91 20 6123 4567', '+1 206 555 0182']));
      expect(r.by.addresses).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'US Office', country: 'US', city: 'Seattle', postalCode: '98101' })]));
    });

    it('finds About and Contact pages in the sitemap when the menu has no links', async () => {
      const r = await preview('Stillwater Labs', 'https://stillwater-labs.example');
      expect(r.sources.map((s) => s.url)).toEqual(['https://stillwater-labs.example/', 'https://stillwater-labs.example/company/about-stillwater', 'https://stillwater-labs.example/get-in-touch']);
      expect(r.by).toMatchObject({ foundedYear: 2004, primaryEmail: 'info@stillwater-labs.example', primaryPhone: '+31 20 555 0199', contactPageUrl: 'https://stillwater-labs.example/get-in-touch' });
    });

    it('tries the usual contact address when there are no links and no sitemap, and reads the people page', async () => {
      const r = await preview('Ashgrove Research', 'https://ashgrove-research.example');
      expect(r.by).toMatchObject({ primaryEmail: 'hello@ashgrove-research.example', primaryPhone: '+44 113 496 0555' });
      expect(r.people.map((p) => [p.name, p.title, p.email, p.linkedinUrl, p.source])).toEqual([
        ['Gareth Lowe', 'Research Director', null, 'https://www.linkedin.com/in/gareth-lowe-example', 'SCHEMA_ORG'],
        ['Helen Marsh', 'Managing Director', null, null, 'WEBSITE'],
        ['Priti Desai', 'Senior Research Consultant', 'priti.desai@ashgrove-research.example', null, 'WEBSITE'],
      ]);
    });

    it('adds the people a data provider knows, when the operator set one up', async () => {
      const env = app.get<ApiEnv>(API_ENV);
      const finderFixture = await startFinderFixture();
      Object.assign(env, { HUNTER_API_KEY: 'hunter-test-key', HUNTER_API_BASE_URL: `${finderFixture.url}/hunter` });
      try {
        const other = api(await registerUser(app, 'Autofill Hunter Org'));
        const r = (await other.post('/companies/autofill-preview', { name: 'Bluefin Logistics', website: 'https://bluefin-logistics.com' }).expect(200)).body as { people: FoundPerson[]; error: string | null };
        expect(r.people).toEqual([{ name: 'Ana Ruiz', title: 'COO', email: 'ana.ruiz@bluefin-logistics.com', linkedinUrl: null, source: 'HUNTER', url: null }]);
        expect(r.error).toBeNull();
        expect(r.people.every((p) => p.source === 'HUNTER' && p.email?.endsWith('@bluefin-logistics.com'))).toBe(true);
      } finally {
        Object.assign(env, { HUNTER_API_KEY: undefined });
        await finderFixture.close();
      }
    });

    it('finds the people a saved company lists, for adding as employees, and stores nothing by itself', async () => {
      const finderUser = await registerUser(app, 'Autofill People Org');
      const finder = api(finderUser);
      const created = (await finder.post('/companies', { name: 'Ashgrove People Co', website: 'https://ashgrove-research.example' }).expect(201)).body as { id: string };
      const contactsBefore = await asTenant(finderUser.tenantId, (tx) => tx.contact.count());
      const r = (await finder.post(`/companies/${created.id}/find-people`).expect(200)).body as { people: FoundPerson[]; error: string | null };
      expect(r.error).toBeNull();
      expect(r.people.map((p) => p.name)).toEqual(expect.arrayContaining(['Helen Marsh', 'Gareth Lowe', 'Priti Desai']));
      expect(r.people.some((p) => p.name === 'Tom Baker')).toBe(false);
      expect(await asTenant(finderUser.tenantId, (tx) => tx.contact.count())).toBe(contactsBefore);
      // A role that cannot add employees is refused.
      const viewer = await inviteMember(app, finderUser, 'viewer');
      await api(viewer).post(`/companies/${created.id}/find-people`).expect(403);
      // A company whose site lists nobody says so.
      const empty = (await finder.post('/companies', { name: 'Offline People Co', website: 'offline-co.example' }).expect(201)).body as { id: string };
      const none = (await finder.post(`/companies/${empty.id}/find-people`).expect(200)).body as { people: FoundPerson[]; error: string | null };
      expect(none.people).toEqual([]);
      expect(none.error).toBeTruthy();
    });
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
    // Office hours the company publishes (ADR 0089), and the zone from its London address.
    expect(c.workingHours).toEqual({ days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30', source: 'website' });
    expect(c.fieldSources.workingHours).toMatchObject({ source: 'SCHEMA_ORG', confidence: 'high' });
    expect(c.timezone).toBe('Europe/London');
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
