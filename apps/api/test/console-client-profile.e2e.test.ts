import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { appClient, ORIGIN, registerUser, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

/** A real PNG of the given size, one colour. */
function png(size: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x44)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * The client profile in the Console (ADR 0074, C4): customer IDs, company details with before and after in the audit
 * log, the logo, and the Locations page's city changes on top of the shipped list.
 */
describe('Console client profile and locations', () => {
  let app: INestApplication;
  let admin: Agent;
  let support: Agent;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const password = 'operator-password-1';
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    patch: (url: string, body: object) => agent.patch(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, data: Buffer, type: string) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).set('content-type', type).send(data),
    del: (url: string) => agent.delete(`/api/v1/operator${url}`).set('origin', ORIGIN),
  });

  beforeAll(async () => {
    saved.OPERATOR_JWT_SECRET = process.env.OPERATOR_JWT_SECRET;
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: `prof-admin-${tag}@platform.test`, name: 'Ada Profile', passwordHash, role: 'ADMIN' },
        { email: `prof-sup-${tag}@platform.test`, name: 'Sam Profile', passwordHash, role: 'SUPPORT' },
      ],
    });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: `prof-admin-${tag}@platform.test`, password }).expect(200);
    await op(support).post('/login', { email: `prof-sup-${tag}@platform.test`, password }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    if (saved.OPERATOR_JWT_SECRET === undefined) delete process.env.OPERATOR_JWT_SECRET;
    else process.env.OPERATOR_JWT_SECRET = saved.OPERATOR_JWT_SECRET;
  });

  it('gives every client a customer ID, in order, and finds a client by it', async () => {
    const first = await registerUser(app, `Ordinal One ${tag}`);
    const second = await registerUser(app, `Ordinal Two ${tag}`);
    const list = (await op(admin).get(`/clients?search=${encodeURIComponent(`Ordinal`)}`).expect(200)).body as { id: string; customerId: string }[];
    const a = list.find((c) => c.id === first.tenantId)!;
    const b = list.find((c) => c.id === second.tenantId)!;
    expect(a.customerId).toMatch(/^SF-\d{6}$/);
    expect(Number(b.customerId.slice(3))).toBeGreaterThan(Number(a.customerId.slice(3)));
    // The number never changes once given.
    expect((await op(admin).get(`/clients/${first.tenantId}`).expect(200)).body.customerId).toBe(a.customerId);
    for (const q of [a.customerId, a.customerId.replace('-', ''), String(Number(a.customerId.slice(3)))]) {
      const found = (await op(admin).get(`/clients?search=${encodeURIComponent(q)}`).expect(200)).body as { id: string }[];
      expect(found.map((c) => c.id)).toContain(first.tenantId);
    }
  });

  it('edits the company details, records before and after, and checks the place', async () => {
    const org = `Profile Mills ${tag}`;
    const owner = await registerUser(app, org);
    const body = {
      name: `${org} Group`, legalName: `${org} Private Limited`, website: 'profilemills.example', industry: 'Manufacturing',
      countryCode: 'in', regionCode: 'MH', city: 'Pune', addressLine1: '12 Mill Road', addressLine2: '', postalCode: '411001',
      contactName: 'Priya Rao', contactEmail: 'Priya@ProfileMills.example', contactPhone: '+91 20 5555 0101',
    };
    // Support Admins may look but not change.
    await op(support).patch(`/clients/${owner.tenantId}/profile`, body).expect(403);
    const detail = (await op(admin).patch(`/clients/${owner.tenantId}/profile`, body).expect(200)).body;
    expect(detail.name).toBe(`${org} Group`);
    expect(detail).toMatchObject({ countryCode: 'IN', city: 'Pune' });
    expect(detail.profile).toEqual({
      legalName: `${org} Private Limited`, website: 'https://profilemills.example', industry: 'Manufacturing', countryCode: 'IN', regionCode: 'MH', city: 'Pune',
      addressLine1: '12 Mill Road', addressLine2: null, postalCode: '411001', contactName: 'Priya Rao', contactEmail: 'priya@profilemills.example', contactPhone: '+91 20 5555 0101',
    });

    const log = (await op(admin).get(`/audit-log?targetType=client&targetId=${owner.tenantId}&action=client.profile_updated`).expect(200)).body as { before: Record<string, unknown>; after: Record<string, unknown> }[];
    expect(log[0]!.before).toMatchObject({ name: org, legalName: null, countryCode: null });
    expect(log[0]!.after).toMatchObject({ name: `${org} Group`, countryCode: 'IN', regionCode: 'MH', city: 'Pune' });

    // A state from another country, an unknown country and a bad address are refused.
    await op(admin).patch(`/clients/${owner.tenantId}/profile`, { ...body, regionCode: 'CA' }).expect(400);
    await op(admin).patch(`/clients/${owner.tenantId}/profile`, { ...body, countryCode: 'XX' }).expect(400);
    await op(admin).patch(`/clients/${owner.tenantId}/profile`, { ...body, contactEmail: 'not-an-email' }).expect(400);
    // Clearing the country clears the state with it.
    const cleared = (await op(admin).patch(`/clients/${owner.tenantId}/profile`, { ...body, countryCode: '' }).expect(200)).body;
    expect(cleared.profile).toMatchObject({ countryCode: null, regionCode: null });
  });

  it('sets, shows and removes the logo, refusing what is not an image', async () => {
    const owner = await registerUser(app, `Logo Works ${tag}`);
    await op(admin).put(`/clients/${owner.tenantId}/logo`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml').expect(400);
    await op(admin).put(`/clients/${owner.tenantId}/logo`, png(8), 'image/png').expect(400);
    await op(admin).put(`/clients/${owner.tenantId}/logo`, Buffer.alloc(2_100_000, 1), 'image/png').expect(413);
    await op(support).put(`/clients/${owner.tenantId}/logo`, png(64), 'image/png').expect(403);
    const set = (await op(admin).put(`/clients/${owner.tenantId}/logo`, png(64), 'image/png').expect(200)).body;
    expect(set.logoUrl).toMatch(new RegExp(`^/api/v1/operator/clients/${owner.tenantId}/logo\\?v=`));
    const img = await op(support).get(`/clients/${owner.tenantId}/logo`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    expect((await op(admin).get(`/clients?search=${encodeURIComponent(`Logo Works ${tag}`)}`).expect(200)).body[0].logoUrl).toBe(set.logoUrl);
    const removed = (await op(admin).del(`/clients/${owner.tenantId}/logo`).expect(200)).body;
    expect(removed.logoUrl).toBeNull();
    await op(admin).get(`/clients/${owner.tenantId}/logo`).expect(404);
  });

  it('adds and renames cities over the shipped list, and undoes both', async () => {
    const regions = (await op(support).get('/locations/IN/regions').expect(200)).body as { code: string; name: string }[];
    expect(regions.find((r) => r.code === 'MH')?.name).toBe('Maharashtra');
    const city = `Tagtown ${tag}`;
    await op(support).post('/locations/cities', { countryCode: 'IN', regionCode: 'MH', name: city }).expect(403);
    const added = (await op(admin).post('/locations/cities', { countryCode: 'in', regionCode: 'MH', name: city }).expect(201)).body as { name: string; edit: { id: string; kind: string } }[];
    const addedEdit = added.find((c) => c.name === city)!.edit;
    expect(addedEdit.kind).toBe('added');
    await op(admin).post('/locations/cities', { countryCode: 'IN', regionCode: 'MH', name: city.toUpperCase() }).expect(400);
    await op(admin).post('/locations/cities', { countryCode: 'IN', regionCode: 'ZZ', name: 'Nowhere' }).expect(400);
    const found = (await op(support).get(`/locations/IN/cities?region=MH&q=${encodeURIComponent('Tagtown')}`).expect(200)).body as { name: string; edit: { kind: string } | null }[];
    expect(found[0]).toMatchObject({ name: city, edit: { kind: 'added' } });

    // Renaming a listed city: the pickers show the new name, and undoing brings the old one back.
    const renamed = `Punasa Town ${tag}`;
    await op(admin).post('/locations/cities/rename', { countryCode: 'IN', regionCode: 'MP', originalName: 'Not A Real Place', name: renamed }).expect(404);
    const after = (await op(admin).post('/locations/cities/rename', { countryCode: 'IN', regionCode: 'MP', originalName: 'Punāsa', name: renamed }).expect(201)).body as { name: string; edit: { id: string; kind: string; originalName: string } }[];
    const renameEdit = after.find((c) => c.name === renamed)!.edit;
    expect(renameEdit).toMatchObject({ kind: 'renamed', originalName: 'Punāsa' });
    const mp = (await op(support).get('/locations/IN/cities?region=MP&q=puna').expect(200)).body as { name: string }[];
    expect(mp.map((c) => c.name)).toContain(renamed);
    expect(mp.map((c) => c.name)).not.toContain('Punāsa');

    await op(admin).del(`/locations/cities/${renameEdit.id}`).expect(200);
    await op(admin).del(`/locations/cities/${addedEdit.id}`).expect(200);
    const back = (await op(support).get('/locations/IN/cities?region=MP&q=puna').expect(200)).body as { name: string }[];
    expect(back.map((c) => c.name)).toContain('Punāsa');
    expect(((await op(support).get(`/locations/IN/cities?region=MH&q=Tagtown`).expect(200)).body as unknown[]).length).toBe(0);
    const audit = (await op(admin).get('/audit-log?targetType=location&limit=10').expect(200)).body as { action: string }[];
    expect(audit.map((i) => i.action)).toEqual(expect.arrayContaining(['location.city_added', 'location.city_renamed', 'location.city_removed', 'location.city_rename_undone']));
  });
});
