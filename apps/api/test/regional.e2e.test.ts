import type { INestApplication } from '@nestjs/common';
import { DEFAULT_REGIONAL } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/** Design spec, localisation: a person's language and regional formats persist on their account. */
describe('language and regional formats', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Regional Co');
    member = await inviteMember(app, owner, 'member');
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts from the defaults, then saves to the database and reads back in canonical form', async () => {
    expect((await api(owner).get('/me/regional').expect(200)).body).toEqual({ regional: DEFAULT_REGIONAL, source: 'default', updatedAt: null });

    const saved = await api(owner).put('/me/regional', { language: 'ar', formatLocale: 'ar-ae' }).expect(200);
    expect(saved.body.source).toBe('user');
    expect(saved.body.regional).toEqual({ language: 'ar', formatLocale: 'ar-AE' });

    const db = ownerClient();
    try {
      const me = (await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } };
      const row = await db.userRegionalSetting.findUniqueOrThrow({ where: { userId: me.user.id } });
      expect(row).toMatchObject({ language: 'ar', formatLocale: 'ar-AE' });
    } finally {
      await db.$disconnect();
    }
    expect((await api(owner).get('/me/regional').expect(200)).body.regional).toEqual({ language: 'ar', formatLocale: 'ar-AE' });
  });

  it('accepts a null format locale and rejects unknown languages, bad tags and extra keys', async () => {
    expect((await api(owner).put('/me/regional', { language: 'de', formatLocale: null }).expect(200)).body.regional).toEqual({ language: 'de', formatLocale: null });
    await api(owner).put('/me/regional', { language: 'xx', formatLocale: null }).expect(400);
    await api(owner).put('/me/regional', { language: 'en', formatLocale: 'not a locale!' }).expect(400);
    await api(owner).put('/me/regional', { language: 'en', formatLocale: null, timeZone: 'UTC' }).expect(400);
    await api(owner).put('/me/regional', { language: 'en' }).expect(400);
  });

  it('is per person, and resetting returns to the defaults', async () => {
    expect((await api(member).get('/me/regional').expect(200)).body.source).toBe('default');
    const reset = await api(owner).del('/me/regional').expect(200);
    expect(reset.body).toEqual({ regional: DEFAULT_REGIONAL, source: 'default', updatedAt: null });
  });
});
