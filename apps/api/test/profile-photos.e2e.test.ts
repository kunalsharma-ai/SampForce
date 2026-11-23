import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import { defaultMobileConfig, type MobileAppConfig } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, ORIGIN, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/** A real PNG of the given size (one colour), so the server's checks see a genuine image. */
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
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x7c)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Profile photos (ADR 0072, M6): set and removed from the web or the phone, seen by the same organisation only. */
describe('profile photos', () => {
  let app: INestApplication;
  let owner: TestUser;
  let exec: TestUser & { userId: string };
  let ownerId = '';
  let execToken = '';
  const http = () => request(app.getHttpServer());
  const signIn = (u: { email: string; password: string }) =>
    http()
      .post('/api/v1/mobile/auth/login')
      .send({ email: u.email, password: u.password, device: { platform: 'IOS', installId: `photo-${randomUUID().slice(0, 8)}`, model: 'iPhone 18', osVersion: '27', appVersion: '1.0.0' } });

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Photo Org');
    exec = await workspacePerson(app, owner, 'EXECUTIVE', 'Field Exec');
    ownerId = ((await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
    await asTenant(owner.tenantId, (tx) => tx.mobileAccess.create({ data: { tenantId: owner.tenantId, status: 'APPROVED', decisionStatus: 'APPROVED', decidedAt: new Date(), activatedAt: new Date(), activatedById: null } }));
    execToken = (await signIn(exec).expect(200)).body.accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('sets a photo from the web, shows it in /auth/me, and serves it to the organisation', async () => {
    expect((await api(owner).get('/auth/me').expect(200)).body.user.photoUrl).toBeNull();
    const res = await owner.agent.put('/api/v1/me/photo').set('origin', ORIGIN).set('content-type', 'image/png').send(png(128)).expect(200);
    expect(res.body.photoUrl).toMatch(new RegExp(`^/api/v1/people/${ownerId}/photo\\?v=`));
    expect((await api(owner).get('/auth/me').expect(200)).body.user.photoUrl).toBe(res.body.photoUrl);
    const img = await owner.agent.get(`/api/v1/people/${ownerId}/photo`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    // A colleague's phone sees it.
    await http().get(`/api/v1/people/${ownerId}/photo`).set('authorization', `Bearer ${execToken}`).expect(200);
  });

  it('sets the photo from the phone, and the session carries it', async () => {
    const set = await http().put('/api/v1/me/photo').set('authorization', `Bearer ${execToken}`).set('content-type', 'image/png').send(png(256)).expect(200);
    const session = (await http().get('/api/v1/mobile/session').set('authorization', `Bearer ${execToken}`).expect(200)).body as { user: { photoUrl: string } };
    expect(session.user.photoUrl).toBe(set.body.photoUrl);
    await owner.agent.get(`/api/v1/people/${exec.userId}/photo`).expect(200);
  });

  it('refuses files that are not photos, too small or too large', async () => {
    const put = (body: Buffer, type = 'image/png') => owner.agent.put('/api/v1/me/photo').set('origin', ORIGIN).set('content-type', type).send(body);
    expect((await put(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml').expect(400)).body.error.code).toBe('PHOTO_INVALID');
    expect((await put(png(32)).expect(400)).body.error.code).toBe('PHOTO_INVALID');
    await put(Buffer.alloc(1_100_000, 1)).expect(413);
  });

  it('keeps photos within the organisation, and the organisation can hide them in the app', async () => {
    const other = await registerUser(app, 'Elsewhere');
    await other.agent.get(`/api/v1/people/${ownerId}/photo`).expect(404);
    const draft = JSON.parse(JSON.stringify(defaultMobileConfig())) as MobileAppConfig;
    draft.profilePictures.visible = false;
    await api(owner).put('/mobile-config/draft', draft).expect(200);
    await api(owner).post('/mobile-config/publish', { note: 'No photos' }).expect(200);
    await http().get(`/api/v1/people/${ownerId}/photo`).set('authorization', `Bearer ${execToken}`).expect(404);
    // Their own photo is still theirs to see, and the web is not affected.
    await http().get(`/api/v1/people/${exec.userId}/photo`).set('authorization', `Bearer ${execToken}`).expect(200);
    await owner.agent.get(`/api/v1/people/${exec.userId}/photo`).expect(200);
  });

  it('removes the photo', async () => {
    await owner.agent.delete('/api/v1/me/photo').set('origin', ORIGIN).expect(204);
    expect((await api(owner).get('/auth/me').expect(200)).body.user.photoUrl).toBeNull();
    await owner.agent.get(`/api/v1/people/${ownerId}/photo`).expect(404);
  });
});
