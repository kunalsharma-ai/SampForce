import type { INestApplication } from '@nestjs/common';
import type { MyProfile, PersonCard, PersonProfile } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/** Personal profiles (ADR 0086): your own headline, quote, bio, contact details, tags, cover and mood. */
describe('personal profiles', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let outsider: TestUser;
  let ownerId = '';

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Profile Org');
    member = await inviteMember(app, owner, 'member');
    outsider = await registerUser(app, 'Other Org');
    ownerId = ((await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts empty, with the sign-in email and the aurora cover', async () => {
    const p = (await api(owner).get('/me/profile').expect(200)).body as MyProfile;
    expect(p).toMatchObject({ userId: ownerId, email: owner.email, headline: null, quote: null, bio: null, linkedinUrl: null, cover: 'aurora', tags: [], mood: null, photoUrl: null, completeness: 0 });
  });

  it('saves the profile, keeps what is left out, and clears what is sent empty', async () => {
    const saved = (
      await api(owner)
        .put('/me/profile', {
          name: 'Priya Nair',
          phone: '+971 50 123 4567',
          headline: 'Head of growth, Gulf region',
          quote: 'Every no brings you closer to a yes.',
          bio: 'Ten years in market research sales.',
          linkedinUrl: 'linkedin.com/in/priya-nair',
          cover: 'sunset',
          tags: ['Healthcare', 'healthcare', 'B2B panels'],
        })
        .expect(200)
    ).body as MyProfile;
    expect(saved).toMatchObject({ name: 'Priya Nair', phone: '+971 50 123 4567', linkedinUrl: 'https://linkedin.com/in/priya-nair', cover: 'sunset', tags: ['healthcare', 'B2B panels'] });
    expect(saved.completeness).toBe(75);
    const again = (await api(owner).put('/me/profile', { bio: '' }).expect(200)).body as MyProfile;
    expect(again.bio).toBeNull();
    expect(again.quote).toBe('Every no brings you closer to a yes.');
    // The new name is the account's name everywhere.
    expect((await api(owner).get('/auth/me').expect(200)).body.user.name).toBe('Priya Nair');
  });

  it('refuses a link that is not LinkedIn, a bad phone, an unknown cover and unknown fields', async () => {
    await api(owner).put('/me/profile', { linkedinUrl: 'https://evil.example/in/x' }).expect(400);
    await api(owner).put('/me/profile', { linkedinUrl: 'javascript:alert(1)' }).expect(400);
    await api(owner).put('/me/profile', { phone: 'call me' }).expect(400);
    await api(owner).put('/me/profile', { cover: 'neon' }).expect(400);
    await api(owner).put('/me/profile', { email: 'new@example.com' }).expect(400);
    await api(owner).put('/me/profile', { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }).expect(400);
  });

  it('sets a mood with one emoji, which clears itself at its end time', async () => {
    await api(owner).put('/me/mood', { emoji: 'happy' }).expect(400);
    await api(owner).put('/me/mood', { emoji: '🎯🚀' }).expect(400);
    await api(owner).put('/me/mood', { emoji: '🎯', expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
    await api(owner).put('/me/mood', { emoji: '🎯', expiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString() }).expect(400);
    const set = (await api(owner).put('/me/mood', { emoji: '🏖️', text: 'On holiday', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(200)).body as MyProfile;
    expect(set.mood).toMatchObject({ emoji: '🏖️', text: 'On holiday' });
    // Bio was cleared above: headline, quote, phone, LinkedIn, tags and mood are six of eight.
    expect(set.completeness).toBe(75);
    // A thumbs up with a skin tone is one emoji.
    expect(((await api(owner).put('/me/mood', { emoji: '👍🏽', text: null }).expect(200)).body as MyProfile).mood).toMatchObject({ emoji: '👍🏽', text: null, expiresAt: null });
    expect(((await api(owner).delUnconfirmed('/me/mood').expect(200)).body as MyProfile).mood).toBeNull();
  });

  it('shows photo, headline and mood of the workspace on cards, and the full profile to teammates only', async () => {
    await api(member).put('/me/mood', { emoji: '☕', text: 'Coffee break' }).expect(200);
    const cards = (await api(owner).get('/people/cards').expect(200)).body as PersonCard[];
    expect(cards.find((c) => c.id === member.userId)).toMatchObject({ mood: { emoji: '☕', text: 'Coffee break' }, photoUrl: null });
    expect(cards.find((c) => c.id === ownerId)).toMatchObject({ name: 'Priya Nair', headline: 'Head of growth, Gulf region', mood: null });
    expect(((await api(outsider).get('/people/cards').expect(200)).body as PersonCard[]).map((c) => c.id)).not.toContain(ownerId);

    const seen = (await api(member).get(`/people/${ownerId}/profile`).expect(200)).body as PersonProfile;
    expect(seen).toMatchObject({ id: ownerId, self: false, name: 'Priya Nair', email: owner.email, phone: '+971 50 123 4567', quote: 'Every no brings you closer to a yes.', cover: 'sunset', role: 'Owner' });
    expect(((await api(owner).get(`/people/${ownerId}/profile`).expect(200)).body as PersonProfile).self).toBe(true);
    await api(outsider).get(`/people/${ownerId}/profile`).expect(404);
  });

  it('expired moods drop off the cards', async () => {
    const db = ownerClient();
    await db.userProfile.update({ where: { userId: member.userId }, data: { moodExpiresAt: new Date(Date.now() - 1000) } });
    await db.$disconnect();
    const cards = (await api(owner).get('/people/cards').expect(200)).body as PersonCard[];
    expect(cards.find((c) => c.id === member.userId)?.mood).toBeNull();
  });
});
