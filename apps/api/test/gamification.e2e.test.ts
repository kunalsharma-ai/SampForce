import type { INestApplication } from '@nestjs/common';
import { DEFAULT_SCORING_RULES } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GamificationService } from '../src/gamification/gamification.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const month = new Date().toISOString().slice(0, 7);

/** Enhancement feature 14: configurable points, leaderboards, badges, competitions and team challenges. */
describe('sales gamification', () => {
  let app: INestApplication;
  let owner: TestUser & { userId?: string };
  let manager: TestUser & { userId: string };
  let member: TestUser & { userId: string };
  let viewer: TestUser & { userId: string };
  let other: TestUser;
  const ids: Record<string, string> = {};
  const rules = { ...DEFAULT_SCORING_RULES, call_logged: { enabled: true, points: 5, dailyCap: 2 } };

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Points Co');
    other = await registerUser(app, 'Elsewhere Points');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'professional', seats: 10 } }));
    manager = await inviteMember(app, owner, 'manager');
    member = await inviteMember(app, owner, 'member');
    viewer = await inviteMember(app, owner, 'viewer');
    ids.owner = (await api(owner).get('/auth/me').expect(200)).body.user.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('is off until an admin turns it on, and only managers can change the rules', async () => {
    expect((await api(member).get('/gamification/me').expect(200)).body).toMatchObject({ enabled: false, canManage: false, score: null });
    expect((await api(manager).get('/gamification/me').expect(200)).body.canManage).toBe(true);
    await api(member).get('/gamification/leaderboard').expect(409);
    await api(member).put('/gamification/settings', { enabled: true, visibility: 'everyone', rules }).expect(403);
    const bad = { ...rules, call_logged: { enabled: true, points: -1, dailyCap: 2 } };
    await api(owner).put('/gamification/settings', { enabled: true, visibility: 'everyone', rules: bad }).expect(400);
    const s = (await api(manager).put('/gamification/settings', { enabled: true, visibility: 'everyone', rules }).expect(200)).body;
    expect(s).toMatchObject({ enabled: true, visibility: 'everyone', baseCurrency: 'USD', updatedBy: { id: manager.userId } });
    expect(s.rules.call_logged).toEqual({ enabled: true, points: 5, dailyCap: 2 });
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirst({ where: { action: 'gamification.settings_updated' } }));
    expect(audit?.metadata).toMatchObject({ enabled: { from: false, to: true }, rules: { call_logged: { from: DEFAULT_SCORING_RULES.call_logged, to: rules.call_logged } } });
  });

  it('manages sales teams from active members', async () => {
    const o = api(owner);
    ids.north = (await o.post('/tenants/current/teams', { name: 'North', memberUserIds: [ids.owner, member.userId] }).expect(201)).body.id;
    const south = (await o.post('/tenants/current/teams', { name: 'South', description: 'Inside sales', memberUserIds: [manager.userId] }).expect(201)).body;
    ids.south = south.id;
    expect(south.members).toEqual([{ id: manager.userId, name: expect.any(String) }]);
    await o.post('/tenants/current/teams', { name: 'North' }).expect(409);
    await o.post('/tenants/current/teams', { name: 'Ghosts', memberUserIds: [ids.owner, '00000000-0000-4000-8000-000000000000'] }).expect(400);
    await api(manager).post('/tenants/current/teams', { name: 'Mine' }).expect(403);
    const temp = (await o.post('/tenants/current/teams', { name: 'Temp' }).expect(201)).body.id;
    await o.put(`/tenants/current/teams/${temp}`, { name: 'Temp 2', memberUserIds: [viewer.userId] }).expect(200);
    await o.del(`/tenants/current/teams/${temp}`).expect(204);
    expect((await api(viewer).get('/tenants/current/teams').expect(200)).body.map((t: { name: string }) => t.name)).toEqual(['North', 'South']);
    await api(other).put(`/tenants/current/teams/${ids.north}`, { name: 'Taken' }).expect(404);
  });

  it('scores CRM work under the rules, with daily caps, and ranks people and teams', async () => {
    const m = api(member);
    const companyId = (await api(owner).post('/companies', { name: 'Acme' }).expect(201)).body.id;
    for (let i = 0; i < 3; i++) await m.post('/activities', { type: 'CALL', subject: `Call ${i}`, companyId }).expect(201);
    await m.post('/activities', { type: 'MEETING', subject: 'Demo', companyId }).expect(201);
    await m.post('/activities', { type: 'NOTE', subject: 'Scratch note', companyId }).expect(201);
    const o = api(owner);
    await o.post('/leads', { fullName: 'Lena Lead', email: 'lena@buyer.test' }).expect(201);
    const stages = (await o.get('/pipelines').expect(200)).body[0].stages as { id: string; category: string }[];
    const deal = (await o.post('/deals', { name: 'Big one', amount: 5000, stageId: stages[0]!.id }).expect(201)).body;
    await o.post(`/deals/${deal.id}/move`, { stageId: stages.find((s) => s.category === 'WON')!.id }).expect(200);

    const board = (await api(viewer).get('/gamification/leaderboard').expect(200)).body;
    expect(board).toMatchObject({ period: { label: month, granularity: 'month' }, currency: 'USD', full: true, missingRates: 0 });
    const me = board.people.find((p: { user: { id: string } }) => p.user.id === member.userId);
    const calls = me.breakdown.find((b: { key: string }) => b.key === 'call_logged');
    expect(calls).toEqual({ key: 'call_logged', count: 3, scored: 2, points: 10 });
    expect(me.breakdown.find((b: { key: string }) => b.key === 'note_logged')).toEqual({ key: 'note_logged', count: 1, scored: 0, points: 0 });
    expect(me).toMatchObject({ points: 20, activities: 4, rank: 2 });
    const top = board.people[0];
    expect(top).toMatchObject({ user: { id: ids.owner }, rank: 1, dealsWon: 1, revenueWon: 5000 });
    expect(top.points).toBe(3 + 5 + 50 + 5);
    expect(board.people.at(-1)).toMatchObject({ points: 0, rank: 3 });
    expect(board.teams.map((t: { team: { name: string }; points: number; members: number; perMember: number }) => [t.team.name, t.points, t.members, t.perMember])).toEqual([
      ['North', 83, 2, 41.5],
      ['South', 0, 1, 0],
    ]);
    expect((await api(viewer).get('/gamification/leaderboard?period=2020-01').expect(200)).body.people.every((p: { points: number }) => p.points === 0)).toBe(true);
    await api(viewer).get('/gamification/leaderboard?period=last-month').expect(400);
  });

  it('can show leaderboards to managers only', async () => {
    await api(owner).put('/gamification/settings', { enabled: true, visibility: 'managers', rules }).expect(200);
    const mine = (await api(member).get('/gamification/leaderboard').expect(200)).body;
    expect(mine).toMatchObject({ full: false, teams: [] });
    expect(mine.people.map((p: { user: { id: string } }) => p.user.id)).toEqual([member.userId]);
    expect((await api(manager).get('/gamification/leaderboard').expect(200)).body.people).toHaveLength(4);
    await api(owner).put('/gamification/settings', { enabled: true, visibility: 'everyone', rules }).expect(200);
  });

  it('awards badges once, with a notification, and shows target progress', async () => {
    const o = api(owner);
    await o.put('/analytics/targets', { period: month, userId: ids.owner, amount: 5000 }).expect(200);
    await api(member).post('/gamification/badges/defaults').expect(403);
    await o.post('/gamification/badges', { name: 'Forever target', metric: 'target_attainment', threshold: 100, window: 'all_time' }).expect(400);
    const badges = (await o.post('/gamification/badges/defaults').expect(201)).body as { name: string }[];
    expect(badges.map((b) => b.name)).toContain('First win');
    expect(((await o.post('/gamification/badges/defaults').expect(201)).body as unknown[]).length).toBe(badges.length);
    const custom = (await api(manager).post('/gamification/badges', { name: 'Busy bee', icon: 'flame', metric: 'activities', threshold: 4, window: 'month' }).expect(201)).body;
    await api(manager).post('/gamification/badges', { name: 'Busy bee', metric: 'calls', threshold: 1, window: 'month' }).expect(409);

    const first = (await o.post('/gamification/badges/evaluate').expect(200)).body;
    expect(first).toEqual({ awarded: 3 });
    expect((await o.post('/gamification/badges/evaluate').expect(200)).body).toEqual({ awarded: 0 });
    const awards = (await api(viewer).get('/gamification/awards').expect(200)).body as { badge: { name: string }; user: { id: string }; period: string }[];
    expect(awards.map((a) => [a.badge.name, a.user.id, a.period]).sort()).toEqual([
      ['Busy bee', member.userId, month],
      ['First win', ids.owner, 'all'],
      ['Target hit', ids.owner, month],
    ]);
    const n = ((await api(member).get('/notifications').expect(200)).body.items as { type: string; title: string }[]).filter((x) => x.type === 'gamification.badge_awarded');
    expect(n.map((x) => x.title)).toEqual(['You earned the "Busy bee" badge']);
    expect((await o.get('/gamification/badges').expect(200)).body.find((b: { id: string }) => b.id === custom.id).awardedCount).toBe(1);

    const me = (await o.get('/gamification/me').expect(200)).body;
    expect(me.targets[0]).toEqual({ period: month, granularity: 'month', target: 5000, won: 5000, attainment: 100 });
    expect(me.targets[1].target).toBeNull();
    expect(me.score).toMatchObject({ rank: 1, attainment: 100, badges: 2 });
    expect(me.badges.map((b: { badge: { name: string } }) => b.badge.name).sort()).toEqual(['First win', 'Target hit']);
    await api(manager).del(`/gamification/badges/${custom.id}`).expect(204);
  });

  it('runs competitions and team challenges on the rules they started with', async () => {
    const mg = api(manager);
    await api(member).post('/gamification/competitions', { name: 'Nope', kind: 'individual', metric: 'points', period: month }).expect(403);
    await mg.post('/gamification/competitions', { name: 'Bad dates', kind: 'individual', metric: 'points', period: null, startDate: '2026-11-10', endDate: '2026-11-01' }).expect(400);
    const sprint = (await mg.post('/gamification/competitions', { name: 'Month sprint', kind: 'individual', metric: 'points', period: month, goal: 40, reward: 'Team lunch' }).expect(201)).body;
    expect(sprint).toMatchObject({ status: 'running', start: `${month}-01`, goal: 40, reward: 'Team lunch' });
    expect(sprint.standings.map((s: { id: string; value: number; rank: number; progress: number }) => [s.id, s.value, s.rank, s.progress])).toEqual([
      [ids.owner, 63, 1, 157.5],
      [member.userId, 20, 2, 50],
      [manager.userId, 0, 3, 0],
      [viewer.userId, 0, 3, 0],
    ]);
    const challenge = (await mg.post('/gamification/competitions', { name: 'Activity challenge', kind: 'team', metric: 'activities', period: month, goal: 10, teamIds: [ids.north, ids.south] }).expect(201)).body;
    expect(challenge.standings).toEqual([
      { id: ids.north, name: 'North', value: 4, rank: 1, progress: 40 },
      { id: ids.south, name: 'South', value: 0, rank: 2, progress: 0 },
    ]);
    const invited = ((await api(member).get('/notifications').expect(200)).body.items as { type: string }[]).filter((x) => x.type === 'gamification.competition_created');
    expect(invited).toHaveLength(2);

    // Changing the workspace rules changes the leaderboard but not a competition already under way.
    await api(owner).put('/gamification/settings', { enabled: true, visibility: 'everyone', rules: { ...rules, meeting_logged: { enabled: true, points: 100, dailyCap: null } } }).expect(200);
    const board = (await api(member).get('/gamification/leaderboard').expect(200)).body;
    expect(board.people.find((p: { user: { id: string } }) => p.user.id === member.userId).points).toBe(110);
    const list = (await api(member).get('/gamification/competitions').expect(200)).body as { id: string; mine: { value: number } | null }[];
    expect(list.find((c) => c.id === sprint.id)!.mine).toMatchObject({ value: 20, rank: 2 });
    expect(list.find((c) => c.id === challenge.id)!.mine).toMatchObject({ id: ids.north });

    const cancelled = (await mg.post(`/gamification/competitions/${sprint.id}/cancel`).expect(200)).body;
    expect(cancelled.status).toBe('cancelled');
    await mg.post(`/gamification/competitions/${sprint.id}/cancel`).expect(409);
    await api(other).post(`/gamification/competitions/${challenge.id}/cancel`).expect(404);
    expect((await api(member).get('/gamification/me').expect(200)).body.competitions.map((c: { id: string }) => c.id)).toEqual([challenge.id]);
  });

  it('keeps each workspace to itself and sweeps only workspaces with gamification on', async () => {
    await api(other).get('/gamification/leaderboard').expect(409);
    expect((await api(other).get('/gamification/awards').expect(200)).body).toEqual([]);
    expect((await api(other).get('/gamification/badges').expect(200)).body).toEqual([]);
    expect(await app.get(GamificationService).sweep(true)).toBeGreaterThanOrEqual(0);
    const awards = await asTenant(owner.tenantId, (tx) => tx.gamificationAward.count({ where: { tenantId: owner.tenantId } }));
    // The deleted "Busy bee" badge took its award with it.
    expect(awards).toBe(2);
  });
});
