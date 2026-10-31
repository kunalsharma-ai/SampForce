import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FinderFixture, startFinderFixture } from './fixtures/finder-fixture';
import { api, asTenant, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

describe('email finder (own finder)', () => {
  let app: INestApplication;
  let fixture: FinderFixture;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let restore: () => void;

  beforeAll(async () => {
    fixture = await startFinderFixture();
    restore = setEnv({ FINDER_FIXTURE_URL: fixture.url, HUNTER_API_KEY: undefined, FINDER_DAILY_LIMIT: '6' });
    app = await startApp();
    owner = await registerUser(app, 'Finder Org');
    http = api(owner);
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    restore();
  });

  it('finds the website from a company name and reads the addresses published there', async () => {
    await http.post('/leads', { fullName: 'Priya Raman', email: 'priya.raman@kestrel-analytics.com' }).expect(201);
    const r = (await http.post('/finder/search', { company: 'Kestrel Analytics' }).expect(200)).body;
    expect(r).toMatchObject({ companyName: 'Kestrel Analytics', domain: 'kestrel-analytics.com', domainSource: 'website', mailServer: true, pattern: '{first}.{last}', patternBasis: 3, provider: 'not_configured' });
    expect(r.emails.map((e: { email: string; name: string; status: string }) => [e.email, e.name, e.status])).toEqual([
      ['priya.raman@kestrel-analytics.com', 'Priya Raman', 'found'],
      ['tomas.herrera@kestrel-analytics.com', 'Tomás Herrera', 'found'],
      ['hannah.cole@kestrel-analytics.com', 'Hannah Cole', 'found'],
      ['projects@kestrel-analytics.com', null, 'found'],
    ]);
    // Another company's address, a personal mailbox and image names are left out; known people are marked.
    expect(r.emails[0].match).toMatchObject({ entity: 'lead', label: 'Priya Raman' });
    expect(r.emails[0].sourceUrl).toBe('https://kestrel-analytics.com/our-people');
  });

  it('builds a person’s address from the company’s pattern, and only guesses when it must', async () => {
    const r = (await http.post('/finder/search', { company: 'https://www.kestrel-analytics.com/about', firstName: 'Owen', lastName: 'Price' }).expect(200)).body;
    expect(r.domainSource).toBe('given');
    expect(r.person).toMatchObject([{ email: 'owen.price@kestrel-analytics.com', status: 'pattern', name: 'Owen Price' }]);

    const known = (await http.post('/finder/search', { company: 'kestrel-analytics.com', firstName: 'Tomás', lastName: 'Herrera' }).expect(200)).body;
    expect(known.person[0]).toMatchObject({ email: 'tomas.herrera@kestrel-analytics.com', status: 'found' });

    // robots.txt keeps /team private, so only info@ is found and there is no pattern: plain guesses, flagged.
    const np = (await http.post('/finder/search', { company: 'northpeak.io', firstName: 'Jane', lastName: 'Doe' }).expect(200)).body;
    expect(np.emails.map((e: { email: string }) => e.email)).toEqual(['info@northpeak.io']);
    expect(np.pattern).toBeNull();
    expect(np.person.map((p: { email: string; status: string }) => [p.email, p.status])).toEqual([
      ['jane.doe@northpeak.io', 'guess'],
      ['jane@northpeak.io', 'guess'],
      ['jdoe@northpeak.io', 'guess'],
    ]);
    expect(np.notes.join(' ')).toContain('not checked');
  });

  it('says plainly when there is no website or no mail server', async () => {
    const none = (await http.post('/finder/search', { company: 'Nonexistent Widgets' }).expect(200)).body;
    expect(none).toMatchObject({ domain: null, emails: [] });
    expect(none.notes[0]).toContain('No website found');
    const quiet = (await http.post('/finder/search', { company: 'quietmail.dev' }).expect(200)).body;
    expect(quiet.mailServer).toBe(false);
    expect(quiet.notes.join(' ')).toContain('no mail server');
  });

  it('saves chosen people as leads, keeps history, and stops at the daily limit', async () => {
    const history = (await http.get('/finder/lookups').expect(200)).body;
    const first = history.find((h: { domain: string; person: string | null }) => h.domain === 'kestrel-analytics.com' && !h.person);
    const saved = (await http.post(`/finder/lookups/${first.id}/save`, { people: [{ email: 'tomas.herrera@kestrel-analytics.com', fullName: 'Tomás Herrera' }, { email: 'priya.raman@kestrel-analytics.com' }] }).expect(200)).body;
    expect(saved.results.map((r: { outcome: string }) => r.outcome)).toEqual(['created', 'existing']);
    const lead = await asTenant(owner.tenantId, (tx) => tx.lead.findFirstOrThrow({ where: { tenantId: owner.tenantId, email: 'tomas.herrera@kestrel-analytics.com' } }));
    expect(lead).toMatchObject({ source: 'Email finder', tags: ['email-finder'], companyName: 'Kestrel Analytics', website: 'kestrel-analytics.com' });
    // Reopening the lookup shows Tomás as saved.
    expect((await http.get(`/finder/lookups/${first.id}`).expect(200)).body.emails[1].match).toMatchObject({ entity: 'lead' });

    expect((await http.get('/finder/usage').expect(200)).body).toEqual({ used: 6, limit: 6, provider: false });
    expect((await http.post('/finder/search', { company: 'kestrel-analytics.com' }).expect(429)).body.error.code).toBe('FINDER_LIMIT');
  });

  it('lets the extension look up the company it is on, and keeps lookups private to each workspace', async () => {
    const other = await registerUser(app, 'Other Org');
    const history = (await http.get('/finder/lookups').expect(200)).body;
    await api(other).get(`/finder/lookups/${history[0].id}`).expect(404);
    const token = (await api(other).post('/extension/connections', { name: 'Chrome' }).expect(201)).body.token;
    const r = (await request(app.getHttpServer()).post('/api/v1/extension/find').set('authorization', `Bearer ${token}`).send({ domain: 'kestrel-analytics.com' }).expect(200)).body;
    expect(r.emails).toHaveLength(4);
    expect(r.emails[0].match).toBeNull();
    // The finder page itself is not open to the extension.
    await request(app.getHttpServer()).get('/api/v1/finder/lookups').set('authorization', `Bearer ${token}`).expect(403);
  });
});

describe('email finder with a Hunter.io key', () => {
  let app: INestApplication;
  let fixture: FinderFixture;
  let http: ReturnType<typeof api>;
  let restore: () => void;

  beforeAll(async () => {
    fixture = await startFinderFixture();
    restore = setEnv({ FINDER_FIXTURE_URL: fixture.url, HUNTER_API_KEY: 'hunter-test-key', HUNTER_API_BASE_URL: `${fixture.url}/hunter` });
    app = await startApp();
    http = api(await registerUser(app, 'Hunter Org'));
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    restore();
  });

  it('adds the provider’s people and uses it to find a domain and a person', async () => {
    const r = (await http.post('/finder/search', { company: 'kestrel-analytics.com' }).expect(200)).body;
    expect(r.provider).toBe('used');
    expect(r.emails.find((e: { email: string }) => e.email === 'owen.price@kestrel-analytics.com')).toMatchObject({ status: 'provider', confidence: 91, position: 'Talent Partner' });
    // Published on the site wins over the provider's copy.
    expect(r.emails.filter((e: { email: string }) => e.email === 'priya.raman@kestrel-analytics.com')).toMatchObject([{ status: 'found' }]);

    const b = (await http.post('/finder/search', { company: 'Bluefin Logistics', firstName: 'Sam', lastName: 'Lee' }).expect(200)).body;
    expect(b).toMatchObject({ domain: 'bluefin-logistics.com', domainSource: 'provider', pagesRead: 0 });
    expect(b.person[0]).toMatchObject({ email: 'slee@bluefin-logistics.com', status: 'provider', confidence: 72 });
    expect(fixture.hunterCalls).toContain('/hunter/domain-search?api_key,company,limit');
    expect((await http.get('/finder/usage').expect(200)).body.provider).toBe(true);
  });
});
