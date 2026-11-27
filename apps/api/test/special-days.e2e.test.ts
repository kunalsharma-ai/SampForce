import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { CompanyEventsSettings, TodaySpecialDays } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/*
 * Today's special days on the home dashboards (Kunal, 2026-11-27): public holidays in the person's country (from their
 * own time zone), world days, and the company's own events, which only the Super Workspace sets.
 */
describe('special days', () => {
  let app: INestApplication;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  const today = async (user: TestUser, date: string, zone?: string, language = 'en') =>
    (await api(user).get(`/special-days/today?date=${date}${zone ? `&zone=${encodeURIComponent(zone)}` : ''}`).set('accept-language', language).expect(200)).body as TodaySpecialDays;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Special Days Ltd');
    rep = await inviteMember(app, owner, 'member');
  });
  afterAll(async () => app.close());

  it('names the public holidays of the person’s own country, from their time zone', async () => {
    const india = await today(rep, '2026-08-15', 'Asia/Kolkata');
    expect(india.country).toBe('IN');
    expect(india.days).toContainEqual({ kind: 'HOLIDAY', name: 'Independence Day', emoji: '🎉', note: null });
    // Chrome still reports India's zone by its old name.
    expect((await today(rep, '2026-08-15', 'Asia/Calcutta')).country).toBe('IN');
    // Festivals India's open data leaves out are still found.
    expect((await today(rep, '2026-11-08', 'Asia/Kolkata')).days).toContainEqual({ kind: 'HOLIDAY', name: 'Diwali', emoji: '🪔', note: null });
    const us = await today(rep, '2026-11-26', 'America/New_York');
    expect(us.country).toBe('US');
    expect(us.days.map((d) => d.name)).toContain('Thanksgiving Day');
    expect(us.days.find((d) => d.name === 'Thanksgiving Day')?.emoji).toBe('🦃');
    // An ordinary day has nothing to show.
    expect((await today(rep, '2026-03-11', 'Asia/Kolkata')).days).toEqual([]);
  });

  it('adds the well-known world days, in the reader’s language, once each', async () => {
    const christmas = await today(rep, '2026-12-25', 'Asia/Kolkata');
    expect(christmas.days.filter((d) => /christmas/i.test(d.name))).toHaveLength(1);
    const women = await today(rep, '2026-03-08', 'Europe/Berlin', 'de');
    expect(women.days).toContainEqual({ kind: 'OBSERVANCE', name: 'Internationaler Frauentag', emoji: '💜', note: null });
    // No zone and no organisation country: still the world days.
    const none = await today(rep, '2026-04-22');
    expect(none.country).toBeNull();
    expect(none.days).toEqual([{ kind: 'OBSERVANCE', name: 'Earth Day', emoji: '🌍', note: null }]);
    await api(rep).get('/special-days/today?date=2026-13-01').expect(400);
  });

  it('shows the company’s own events first, set only by the Super Workspace, every year when asked', async () => {
    const empty = (await api(owner).get('/crm-config/company-events').expect(200)).body as CompanyEventsSettings;
    expect(empty).toEqual({ events: [], canEdit: true });
    const events = [
      { title: 'Founding Day', emoji: '🏢', date: '2015-11-27', yearly: true, note: 'Cake in the kitchen at 4 pm' },
      { title: 'Offsite', emoji: '🏝️', date: '2026-11-27', yearly: false, note: null },
      { title: 'Last year only', date: '2025-11-27' },
    ];
    await api(rep).put('/crm-config/company-events', { events }).expect(403);
    const manager = await workspacePerson(app, owner, 'MANAGER', 'Events Manager');
    await api(manager).put('/crm-config/company-events', { events }).expect(403);
    await api(owner).put('/crm-config/company-events', { events: [{ title: '', date: '2026-01-01' }] }).expect(400);
    await api(owner).put('/crm-config/company-events', { events: [{ title: 'X', date: '2026-01-01', extra: 1 }] }).expect(400);
    const saved = (await api(owner).put('/crm-config/company-events', { events }).expect(200)).body as CompanyEventsSettings;
    expect(saved.events.map((e) => e.title).sort()).toEqual(['Founding Day', 'Last year only', 'Offsite']);
    expect(saved.events.every((e) => typeof e.id === 'string')).toBe(true);
    expect(saved.events.find((e) => e.title === 'Last year only')).toMatchObject({ emoji: '🎉', yearly: false, note: null });

    const day = await today(rep, '2026-11-27', 'Asia/Kolkata');
    expect(day.days.slice(0, 2)).toEqual([
      { kind: 'COMPANY', name: 'Founding Day', emoji: '🏢', note: 'Cake in the kitchen at 4 pm' },
      { kind: 'COMPANY', name: 'Offsite', emoji: '🏝️', note: null },
    ]);
    // A yearly event comes back next year; a one-off does not.
    expect((await today(rep, '2027-11-27', 'Asia/Kolkata')).days.filter((d) => d.kind === 'COMPANY').map((d) => d.name)).toEqual(['Founding Day']);

    // Saving again keeps ids, so an edit is an edit.
    const founding = saved.events.find((e) => e.title === 'Founding Day')!;
    const again = (await api(owner).put('/crm-config/company-events', { events: [{ ...founding, title: 'Founders’ Day' }] }).expect(200)).body as CompanyEventsSettings;
    expect(again.events).toEqual([{ ...founding, title: 'Founders’ Day' }]);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action: 'crm_settings.company_events_updated' } }));
    expect(audit).toHaveLength(2);

    // Other organisations never see them.
    const other = await registerUser(app, 'Other Org');
    expect((await today(other, '2026-11-27', 'Asia/Kolkata')).days.filter((d) => d.kind === 'COMPANY')).toEqual([]);
  });

  it('gives the Console the operator’s holidays and world days', async () => {
    const saved = process.env.OPERATOR_JWT_SECRET;
    process.env.OPERATOR_JWT_SECRET = 'operator-secret-that-is-at-least-32-chars';
    const ops = await startApp();
    try {
      const tag = randomUUID().slice(0, 6);
      const db = appClient();
      await db.platformOperator.create({ data: { email: `days-${tag}@platform.test`, name: 'Dana Days', passwordHash: await new PasswordService().hash('operator-password-1'), role: 'ADMIN' } });
      await db.$disconnect();
      const agent = request.agent(ops.getHttpServer());
      await agent.get('/api/v1/operator/special-days/today?date=2026-12-25').expect(401);
      await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: `days-${tag}@platform.test`, password: 'operator-password-1' }).expect(200);
      const res = (await agent.get('/api/v1/operator/special-days/today?date=2026-01-26&zone=Asia%2FKolkata').expect(200)).body as TodaySpecialDays;
      expect(res).toMatchObject({ country: 'IN' });
      expect(res.days.map((d) => d.name)).toEqual(['Republic Day']);
    } finally {
      await ops.close();
      if (saved === undefined) delete process.env.OPERATOR_JWT_SECRET;
      else process.env.OPERATOR_JWT_SECRET = saved;
    }
  });
});
