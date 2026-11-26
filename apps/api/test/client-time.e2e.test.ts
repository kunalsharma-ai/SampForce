import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, registerUser, startApp, type TestUser } from './helpers';

/** Client time and the best time to connect (ADR 0088): my own hours, office hours on records, public holidays. */
describe('client time', () => {
  let app: INestApplication;
  let owner: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Time Co');
    other = await registerUser(app, 'Elsewhere Time');
  });
  afterAll(async () => {
    await app.close();
  });

  it('my own zone starts as IST, asks first, and is saved per person', async () => {
    const http = api(owner);
    expect((await http.get('/me/contact-times').expect(200)).body).toEqual({
      contactTimes: { timeZone: 'Asia/Kolkata', start: '09:00', end: '23:00', confirmBeforeContact: true },
      source: 'default',
    });
    const saved = (await http.put('/me/contact-times', { timeZone: 'Europe/London', start: '08:00', end: '20:00', confirmBeforeContact: false }).expect(200)).body;
    expect(saved).toEqual({ contactTimes: { timeZone: 'Europe/London', start: '08:00', end: '20:00', confirmBeforeContact: false }, source: 'user' });
    expect((await http.get('/me/contact-times').expect(200)).body.source).toBe('user');
    // Someone else still has the defaults.
    expect((await api(other).get('/me/contact-times').expect(200)).body.source).toBe('default');
    await http.put('/me/contact-times', { timeZone: 'Mars/Olympus', start: '08:00', end: '20:00', confirmBeforeContact: true }).expect(400);
    await http.put('/me/contact-times', { timeZone: 'Asia/Kolkata', start: '8am', end: '20:00', confirmBeforeContact: true }).expect(400);
    expect((await http.del('/me/contact-times').expect(200)).body.source).toBe('default');
  });

  it('keeps office hours on companies and employees, marks typed hours as the user’s, and clears them', async () => {
    const http = api(owner);
    const company = (await http.post('/companies', { name: 'Hudson Panels', country: 'US', state: 'New York', city: 'New York', workingHours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00', source: 'website' } }).expect(201)).body;
    expect(company.workingHours).toEqual({ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00', source: 'user' });
    const read = (await http.get(`/companies/${company.id}`).expect(200)).body;
    expect(read.workingHours.start).toBe('08:00');
    const cleared = (await http.patch(`/companies/${company.id}`, { workingHours: null }).expect(200)).body;
    expect(cleared.workingHours).toBeNull();
    await http.patch(`/companies/${company.id}`, { workingHours: { days: [1], start: '18:00', end: '09:00', source: 'user' } }).expect(400);

    const person = (await http.post('/contacts', { firstName: 'Lena', companyId: company.id, country: 'US', state: 'California', workingHours: { days: [1, 2, 3, 4], start: '07:00', end: '15:00', source: 'user' } }).expect(201)).body;
    expect(person.workingHours).toEqual({ days: [1, 2, 3, 4], start: '07:00', end: '15:00', source: 'user' });
    expect((await http.patch(`/contacts/${person.id}`, { workingHours: null }).expect(200)).body.workingHours).toBeNull();
    // Records without hours read as null (the card then uses the country's usual day).
    expect((await http.post('/companies', { name: 'No Hours Ltd' }).expect(201)).body.workingHours).toBeNull();
  });

  it('lists public holidays for a country and state', async () => {
    const http = api(owner);
    const us = (await http.get('/geo/countries/US/holidays?state=New%20York&from=2026-12-20&days=14').expect(200)).body;
    expect(us.covered).toBe(true);
    expect(us.holidays).toEqual(expect.arrayContaining([{ date: '2026-12-25', name: 'Christmas Day' }, { date: '2027-01-01', name: "New Year's Day" }]));
    expect(us.holidays.every((h: { date: string }) => h.date >= '2026-12-20' && h.date < '2027-01-03')).toBe(true);
    const india = (await http.get('/geo/countries/IN/holidays?from=2027-01-20&days=10').expect(200)).body;
    expect(india.holidays.map((h: { date: string }) => h.date)).toContain('2027-01-26');
    // A state given by its code works too.
    expect((await http.get('/geo/countries/US/holidays?state=NY&from=2026-12-24&days=3').expect(200)).body.holidays).toHaveLength(1);
    await http.get('/geo/countries/XX/holidays?from=2026-12-20').expect(404);
    await http.get('/geo/countries/US/holidays?from=tomorrow').expect(400);
  });
});
