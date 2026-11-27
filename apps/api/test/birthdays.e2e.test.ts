import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { MyProfile, PersonProfile, TodayBirthdays } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/**
 * Birthdays (ADR 0087): a date of birth on My profile, the year private unless shared, and today's birthdays for the
 * celebration on every dashboard: the workspace's people, and in the Console the operators with the same email.
 */
describe('birthdays', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let quiet: TestUser & { userId: string };
  let outsider: TestUser;
  let ownerId = '';
  const today = '2027-03-14';

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = 'operator-secret-that-is-at-least-32-chars';
    app = await startApp();
    owner = await registerUser(app, 'Birthday Org');
    member = await inviteMember(app, owner, 'member');
    quiet = await inviteMember(app, owner, 'member');
    outsider = await registerUser(app, 'Other Birthday Org');
    ownerId = ((await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('saves a date of birth, keeps the year private by default, and checks the date is real', async () => {
    const empty = (await api(owner).get('/me/profile').expect(200)).body as MyProfile;
    expect(empty).toMatchObject({ birthday: null, birthYearVisible: false, celebrateBirthday: true });

    await api(owner).put('/me/profile', { birthday: { day: 31, month: 4 } }).expect(400);
    await api(owner).put('/me/profile', { birthday: { day: 29, month: 2, year: 1991 } }).expect(400);
    await api(owner).put('/me/profile', { birthday: { day: 1, month: 1, year: new Date().getUTCFullYear() - 2 } }).expect(400);

    const saved = (await api(owner).put('/me/profile', { birthday: { day: 14, month: 3, year: 1990 } }).expect(200)).body as MyProfile;
    expect(saved.birthday).toEqual({ day: 14, month: 3, year: 1990 });
    // Teammates see the day and month only.
    const seen = (await api(member).get(`/people/${ownerId}/profile`).expect(200)).body as PersonProfile;
    expect(seen.birthday).toEqual({ day: 14, month: 3, year: null });
    expect(seen).not.toHaveProperty('birthYearVisible');

    await api(owner).put('/me/profile', { birthYearVisible: true }).expect(200);
    expect(((await api(member).get(`/people/${ownerId}/profile`).expect(200)).body as PersonProfile).birthday).toEqual({ day: 14, month: 3, year: 1990 });
  });

  it("lists today's birthdays in the workspace for the reader's date, their own first", async () => {
    await api(member).put('/me/profile', { name: 'Arjun Mehta', birthday: { day: 14, month: 3, year: 1995 } }).expect(200);
    // A teammate who keeps their birthday to themselves is not celebrated by others.
    await api(quiet).put('/me/profile', { birthday: { day: 14, month: 3 }, celebrateBirthday: false }).expect(200);
    await api(outsider).put('/me/profile', { birthday: { day: 14, month: 3 } }).expect(200);

    const forOwner = (await api(owner).get(`/people/birthdays?date=${today}`).expect(200)).body as TodayBirthdays;
    expect(forOwner.date).toBe(today);
    expect(forOwner.people.map((p) => [p.self, p.age])).toEqual([
      [true, 37],
      [false, null],
    ]);
    expect(forOwner.people[1]).toMatchObject({ id: member.userId, name: 'Arjun Mehta' });

    // The member sees the owner's age, which the owner shares; the quiet teammate sees only their own day.
    const forMember = (await api(member).get(`/people/birthdays?date=${today}`).expect(200)).body as TodayBirthdays;
    expect(forMember.people.map((p) => [p.self, p.age])).toEqual([
      [true, 32],
      [false, 37],
    ]);
    // Kept private, it still shows to the person themselves.
    const forQuiet = (await api(quiet).get(`/people/birthdays?date=${today}`).expect(200)).body as TodayBirthdays;
    expect(forQuiet.people.map((p) => p.self)).toEqual([true, false, false]);
    expect(forOwner.people.some((p) => p.id === quiet.userId)).toBe(false);

    expect(((await api(owner).get('/people/birthdays?date=2027-03-15').expect(200)).body as TodayBirthdays).people).toEqual([]);
    await api(owner).get('/people/birthdays?date=14-03-2027').expect(400);
    await api(owner).get('/people/birthdays').expect(400);
  });

  it('celebrates 29 February on 28 February in other years', async () => {
    await api(member).put('/me/profile', { birthday: { day: 29, month: 2, year: 1996 } }).expect(200);
    const names = async (date: string) => ((await api(owner).get(`/people/birthdays?date=${date}`).expect(200)).body as TodayBirthdays).people.map((p) => p.id);
    expect(await names('2027-02-28')).toEqual([member.userId]);
    expect(await names('2028-02-28')).toEqual([]);
    expect(await names('2028-02-29')).toEqual([member.userId]);
    // Clearing the date stops it.
    await api(member).put('/me/profile', { birthday: null }).expect(200);
    expect(await names('2028-02-29')).toEqual([]);
  });

  it('shows Console operators the birthdays of operators whose SampForce account shares the email', async () => {
    const tag = randomUUID().slice(0, 6);
    const db = appClient();
    const passwordHash = await new PasswordService().hash('operator-password-1');
    await db.platformOperator.create({ data: { email: owner.email, name: 'Owner Ops', passwordHash, role: 'ADMIN' } });
    await db.platformOperator.create({ data: { email: `plain-${tag}@platform.test`, name: 'Plain Ops', passwordHash, role: 'SUPPORT' } });
    await db.$disconnect();
    const ops = request.agent(app.getHttpServer());
    await ops.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: `plain-${tag}@platform.test`, password: 'operator-password-1' }).expect(200);
    const list = (await ops.get(`/api/v1/operator/birthdays?date=${today}`).expect(200)).body as TodayBirthdays;
    expect(list.people.filter((p) => p.name === 'Owner Ops')).toEqual([expect.objectContaining({ self: false, age: 37 })]);
    await request(app.getHttpServer()).get(`/api/v1/operator/birthdays?date=${today}`).expect(401);
  });
});
