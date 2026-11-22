import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompanyLogosService } from '../src/crm/company-logos.service';
import { ico, type LogoFixture, png, startLogoFixture } from './fixtures/logo-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

/** Company logos found from the website by the worker, uploaded, removed and served (ADR 0070). */
describe('company logos', () => {
  let app: INestApplication;
  let fixture: LogoFixture;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let logos: CompanyLogosService;
  let restore: () => void;

  const runWorker = () => logos.runDue(new Date(), true);
  const company = async (id: string) => (await http.get(`/companies/${id}`).expect(200)).body;
  const binary = (res: { on: (e: string, cb: (c?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c!));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  const image = (url: string, user = owner) => user.agent.get(url).buffer(true).parse(binary);
  const upload = (id: string, body: Buffer, type = 'image/png') => owner.agent.put(`/api/v1/companies/${id}/logo`).set('origin', ORIGIN).set('content-type', type).send(body);

  beforeAll(async () => {
    fixture = await startLogoFixture();
    restore = setEnv({ LOGO_FIXTURE_URL: fixture.url });
    app = await startApp();
    logos = app.get(CompanyLogosService);
    owner = await registerUser(app, 'Logo Org');
    http = api(owner);
  });

  afterAll(async () => {
    await logos.settle();
    await app.close();
    await fixture.close();
    restore();
  });

  it('finds the logo from the website the company was saved with', async () => {
    const c = (await http.post('/companies', { name: 'Brightwave', website: 'https://www.brightwave.example/about', country: 'GB' }).expect(201)).body;
    expect(c.logo).toEqual({ url: null, source: 'AUTO', status: 'PENDING', width: null });
    expect(await runWorker()).toBeGreaterThanOrEqual(1);
    const after = await company(c.id);
    expect(after.logo).toMatchObject({ source: 'AUTO', status: 'FOUND', width: 180 });
    expect(after.logo.url).toMatch(new RegExp(`^/api/v1/companies/${c.id}/logo\\?v=`));
    // The apple-touch-icon (180px) beat the 32px favicon, and the favicon was never downloaded.
    expect(fixture.hits).toContain('brightwave.example/static/touch.png');
    expect(fixture.hits).not.toContain('brightwave.example/favicon-32.png');

    const img = await image(after.logo.url).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(img.body as Buffer, png(180, [16, 185, 129]))).toBe(0);

    // The list carries the same reference (and no image bytes).
    const list = (await http.get('/companies?q=Brightwave').expect(200)).body;
    expect(list.items[0].logo).toEqual(after.logo);
  });

  it('follows the redirect to www and takes favicon.ico when the page names no icon', async () => {
    const c = (await http.post('/companies', { name: 'Oldfield', domain: 'oldfield.example' }).expect(201)).body;
    await runWorker();
    expect((await company(c.id)).logo).toMatchObject({ status: 'FOUND', width: 48 });
    const img = await image((await company(c.id)).logo.url).expect(200);
    expect(img.headers['content-type']).toBe('image/x-icon');
    expect((img.body as Buffer).length).toBe(ico(48).length);
  });

  it('keeps SVG logos and serves them sandboxed', async () => {
    const c = (await http.post('/companies', { name: 'Vectorly', website: 'https://vectorly.example' }).expect(201)).body;
    await runWorker();
    const logo = (await company(c.id)).logo;
    expect(logo).toMatchObject({ status: 'FOUND', width: null });
    const img = await image(logo.url).expect(200);
    expect(img.headers['content-type']).toBe('image/svg+xml');
    expect(img.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    // The Safari mask icon is a silhouette, not a logo, so it is never fetched.
    expect(fixture.hits).not.toContain('vectorly.example/mask.svg');
  });

  it('marks sites without a usable icon, and retries sites that do not answer before giving up', async () => {
    const liar = (await http.post('/companies', { name: 'Liar', website: 'https://liar.example' }).expect(201)).body;
    const gone = (await http.post('/companies', { name: 'Gone', website: 'https://gone.example' }).expect(201)).body;
    await runWorker();
    expect((await company(liar.id)).logo).toEqual({ url: null, source: 'AUTO', status: 'NOT_FOUND', width: null });
    // Unreachable: still pending, due again later; after the last retry it is FAILED.
    expect((await company(gone.id)).logo.status).toBe('PENDING');
    for (let i = 0; i < 3; i++) {
      await asTenant(owner.tenantId, (tx) => tx.companyLogo.updateMany({ where: { companyId: gone.id }, data: { nextRunAt: new Date(0) } }));
      await runWorker();
    }
    expect((await company(gone.id)).logo.status).toBe('FAILED');
    await image(`/api/v1/companies/${liar.id}/logo`).expect(404);
  });

  it('looks again when the website changes and drops the automatic logo when it is removed', async () => {
    const c = (await http.post('/companies', { name: 'Mover', website: 'https://liar.example' }).expect(201)).body;
    await runWorker();
    expect((await company(c.id)).logo.status).toBe('NOT_FOUND');
    expect((await http.patch(`/companies/${c.id}`, { website: 'https://brightwave.example' }).expect(200)).body.logo.status).toBe('PENDING');
    await runWorker();
    expect((await company(c.id)).logo).toMatchObject({ status: 'FOUND', width: 180 });
    // Changing something else does not look again.
    expect((await http.patch(`/companies/${c.id}`, { industry: 'Media' }).expect(200)).body.logo.status).toBe('FOUND');
    expect((await http.patch(`/companies/${c.id}`, { website: null, domain: null }).expect(200)).body.logo).toBeNull();
  });

  it('uploads a logo that wins over the website, and goes back to the website when it is removed', async () => {
    const c = (await http.post('/companies', { name: 'Uploader', website: 'https://brightwave.example' }).expect(201)).body;
    const mine = png(256, [234, 88, 12]);
    const up = await upload(c.id, mine).expect(200);
    expect(up.body).toMatchObject({ source: 'UPLOAD', status: 'FOUND', width: 256 });
    await runWorker();
    expect((await company(c.id)).logo.source).toBe('UPLOAD');
    expect(Buffer.compare((await image(up.body.url).expect(200)).body as Buffer, mine)).toBe(0);
    // An uploaded logo survives a change of website and cannot be "refreshed" over.
    expect((await http.patch(`/companies/${c.id}`, { website: 'https://vectorly.example' }).expect(200)).body.logo.source).toBe('UPLOAD');
    expect((await http.post(`/companies/${c.id}/logo/refresh`).expect(409)).body.error.code).toBe('LOGO_UPLOADED');

    const removed = (await http.del(`/companies/${c.id}/logo`).expect(200)).body;
    expect(removed.logo).toMatchObject({ source: 'AUTO', status: 'PENDING' });
    await runWorker();
    expect((await company(c.id)).logo).toMatchObject({ source: 'AUTO', status: 'FOUND', width: null });

    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { entityId: c.id, action: { startsWith: 'company.logo_' } }, select: { action: true } }));
    expect(audit.map((a) => a.action).sort()).toEqual(['company.logo_removed', 'company.logo_uploaded']);
  });

  it('refuses uploads that are not images, too small or too big', async () => {
    const c = (await http.post('/companies', { name: 'Strict Co' }).expect(201)).body;
    expect(c.logo).toBeNull();
    expect((await upload(c.id, Buffer.from('<html><script>alert(1)</script></html>'), 'image/png').expect(400)).body.error.code).toBe('INVALID_IMAGE');
    expect((await upload(c.id, png(8)).expect(400)).body.error.code).toBe('IMAGE_TOO_SMALL');
    expect((await upload(c.id, Buffer.alloc(1_100_000, 1), 'image/png').expect(413)).body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect((await http.post(`/companies/${c.id}/logo/refresh`).expect(400)).body.error.code).toBe('NO_WEBSITE');
    // Without a website, removing an upload leaves the company with no logo.
    await upload(c.id, png(64)).expect(200);
    expect((await http.del(`/companies/${c.id}/logo`).expect(200)).body.logo).toBeNull();
  });

  it('queues companies saved before logos existed when they are listed', async () => {
    const c = (await http.post('/companies', { name: 'Legacy', website: 'https://brightwave.example' }).expect(201)).body;
    await asTenant(owner.tenantId, (tx) => tx.companyLogo.deleteMany({ where: { companyId: c.id } }));
    expect((await company(c.id)).logo).toBeNull();
    // The listing queued it after answering.
    for (let i = 0; i < 20 && !(await company(c.id)).logo; i++) await new Promise((r) => setTimeout(r, 100));
    expect((await company(c.id)).logo?.status).toBe('PENDING');
    await runWorker();
    expect((await company(c.id)).logo.status).toBe('FOUND');
  });

  it('shows a logo only to people who can see the company, and keeps workspaces apart', async () => {
    const c = (await http.post('/companies', { name: 'Private Co', website: 'https://brightwave.example' }).expect(201)).body;
    await runWorker();
    const url = (await company(c.id)).logo.url as string;
    const member = await inviteMember(app, owner, 'member');
    // New workspaces give members their own records only, so the owner's company is not theirs to see.
    await image(url, member).expect(404);
    await member.agent.put(`/api/v1/companies/${c.id}/logo`).set('origin', ORIGIN).set('content-type', 'image/png').send(png(64)).expect(404);
    const other = await registerUser(app, 'Other Org');
    await image(url, other).expect(404);
    await image(url, { ...owner, agent: (await import('supertest')).default.agent(app.getHttpServer()) }).expect(401);
  });
});
