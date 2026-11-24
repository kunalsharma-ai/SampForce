import type { INestApplication } from '@nestjs/common';
import { PASSWORD_CONFIRMATION_HEADER } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, confirmationFor, inviteMember, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Password confirmation before destructive actions (workspace redesign W1, spec sections 6, 13, 14 and 17). The server
 * refuses a destructive request without a fresh one-time pass, whatever the interface shows; the pass works once, only
 * for the session that asked, and lapses after five minutes; wrong passwords are counted and logged as refused.
 */

describe('password confirmation before deleting', () => {
  let app: INestApplication;
  let owner: TestUser;
  let colleague: TestUser;

  const newLead = async (who: TestUser, name: string) => (await api(who).post('/leads', { fullName: name, email: `${name.split(' ')[0]!.toLowerCase()}@buyer.test` }).expect(201)).body.lead.id as string;
  const leadExists = async (who: TestUser, id: string) => (await api(who).get(`/leads/${id}`)).status === 200;
  const refusedEntries = async (action: string) =>
    asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action, outcome: 'REFUSED' } }));

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Confirm Org');
    colleague = await inviteMember(app, owner, 'admin');
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a delete without a password confirmation and keeps the record', async () => {
    const id = await newLead(owner, 'Nadia Nopass');
    const res = await api(owner).delUnconfirmed(`/leads/${id}`).expect(403);
    expect(res.body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    expect(res.body.error.message).toBe('Enter your password to delete this.');
    expect(await leadExists(owner, id)).toBe(true);
  });

  it('turns down a wrong password, logs it as refused, and issues a pass for the right one', async () => {
    const wrong = await api(owner).post('/auth/confirm-password', { password: 'not-my-password-9' }).expect(400);
    expect(wrong.body.error.code).toBe('PASSWORD_INCORRECT');
    expect(wrong.body.error.details[0].path).toBe('password');
    expect((await refusedEntries('security.password_check_failed')).length).toBeGreaterThan(0);

    const ok = await api(owner).post('/auth/confirm-password', { password: owner.password }).expect(200);
    expect(typeof ok.body.token).toBe('string');
    const minutes = (Date.parse(ok.body.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThanOrEqual(5);
  });

  it('deletes with a pass, and a pass works only once', async () => {
    const first = await newLead(owner, 'Olga Once');
    const second = await newLead(owner, 'Omar Once');
    const pass = await confirmationFor(owner);
    await owner.agent.delete(`/api/v1/leads/${first}`).set('origin', ORIGIN).set(PASSWORD_CONFIRMATION_HEADER, pass).expect(204);
    expect(await leadExists(owner, first)).toBe(false);

    const again = await owner.agent.delete(`/api/v1/leads/${second}`).set('origin', ORIGIN).set(PASSWORD_CONFIRMATION_HEADER, pass).expect(403);
    expect(again.body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    expect(again.body.error.message).toBe('Your password check has expired. Enter your password again.');
    expect(await leadExists(owner, second)).toBe(true);
    const refused = await refusedEntries('security.delete_refused');
    expect(refused.some((r) => (r.metadata as { path?: string }).path === `/api/v1/leads/${second}`)).toBe(true);
  });

  it('does not accept another person’s pass, nor an expired one', async () => {
    const id = await newLead(owner, 'Pia Pass');
    const theirs = await confirmationFor(colleague);
    await owner.agent.delete(`/api/v1/leads/${id}`).set('origin', ORIGIN).set(PASSWORD_CONFIRMATION_HEADER, theirs).expect(403);

    const mine = await confirmationFor(owner);
    await ownerClient().passwordConfirmation.updateMany({ where: { usedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await owner.agent.delete(`/api/v1/leads/${id}`).set('origin', ORIGIN).set(PASSWORD_CONFIRMATION_HEADER, mine).expect(403);
    expect(await leadExists(owner, id)).toBe(true);
  });

  it('confirms a bulk delete once for the whole selection, and lets other bulk actions through', async () => {
    const ids = [await newLead(owner, 'Quin Bulk'), await newLead(owner, 'Rosa Bulk')];
    await api(owner).post('/records/bulk', { entity: 'leads', ids, action: 'status', status: 'CONTACTED' }).expect(200);
    const refused = await api(owner).post('/records/bulk', { entity: 'leads', ids, action: 'delete' }).expect(403);
    expect(refused.body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    const pass = await confirmationFor(owner);
    await owner.agent.post('/api/v1/records/bulk').set('origin', ORIGIN).set(PASSWORD_CONFIRMATION_HEADER, pass).send({ entity: 'leads', ids, action: 'delete' }).expect(200);
    for (const id of ids) expect(await leadExists(owner, id)).toBe(false);
  });

  it('keeps quick removals quick: a saved view and an invitation need no password', async () => {
    const view = (await api(owner).post('/views', { entity: 'leads', name: 'Mine', filters: {}, columns: ['name'] })).body as { id?: string };
    if (view.id) await api(owner).delUnconfirmed(`/views/${view.id}`).expect((r) => expect([200, 204]).toContain(r.status));
    const inv = (await api(owner).post('/tenants/current/invitations', { email: 'quick@buyer.test', roleKey: 'member' }).expect(201)).body as { id: string };
    await api(owner).delUnconfirmed(`/tenants/current/invitations/${inv.id}`).expect((r) => expect([200, 204]).toContain(r.status));
  });

  it('pauses the check after five wrong passwords, even for the right one', async () => {
    const person = await inviteMember(app, owner, 'member');
    for (let i = 0; i < 5; i++) await api(person).post('/auth/confirm-password', { password: `wrong-${i}-password` }).expect(400);
    const paused = await api(person).post('/auth/confirm-password', { password: person.password }).expect(429);
    expect(paused.body.error.code).toBe('PASSWORD_CHECK_PAUSED');
    expect(paused.body.error.message).toBe('Too many wrong passwords. Try again in 15 minutes.');
  });
});
