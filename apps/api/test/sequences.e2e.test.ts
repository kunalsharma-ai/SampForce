import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SequenceRunner } from '../src/sequences/sequence-runner.service';
import { startProviderFixture, providerEnv, type ProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Decodes what the Gmail adapter sent: headers plus the text and HTML parts. */
function decodeSent(body: string): { headers: string; text: string; html: string } {
  const mime = Buffer.from((JSON.parse(body) as { raw: string }).raw, 'base64url').toString();
  const [headers = '', ...rest] = mime.split('\r\n\r\n');
  const parts = rest.join('\r\n\r\n');
  const chunks = [...parts.matchAll(/Content-Type: text\/(plain|html); charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)];
  const get = (t: string) => Buffer.from((chunks.find((c) => c[1] === t)?.[2] ?? '').replace(/\r\n/g, ''), 'base64').toString();
  return { headers, text: get('plain'), html: get('html') };
}

const ALL_DAY = { sendDays: [0, 1, 2, 3, 4, 5, 6], sendStart: '00:00', sendEnd: '23:59', timezone: 'UTC', dailyLimit: 50, trackOpens: true, trackClicks: true };

describe('email templates and sequences', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let runner: SequenceRunner;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  const saved: Record<string, string | undefined> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    runner = app.get(SequenceRunner);
    owner = await registerUser(app, 'Sequencers');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
    http = api(owner);
    const lead = async (body: object) => (await http.post('/leads', body).expect(201)).body.lead.id as string;
    ids.ana = await lead({ fullName: 'Ana Buyer', email: 'ana@buyer.test', companyName: 'Buyer Co', jobTitle: 'Head of Ops' });
    ids.ben = await lead({ fullName: 'Ben Bounce', email: 'ben@gone.test', companyName: 'Gone Ltd' });
    ids.cat = await lead({ fullName: 'Cat Clicker', email: 'cat@click.test', companyName: 'Click Inc' });
    ids.noEmail = await lead({ fullName: 'No Email' });
    ids.optedOut = await lead({ fullName: 'Olly Out', email: 'olly@out.test', marketingConsent: 'OPTED_OUT' });
    ids.dee = await lead({ fullName: 'Dee', email: 'dee@nocompany.test' });
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function connectGoogle(h: ReturnType<typeof api>) {
    const { url } = (await h.post('/integrations/google/connect').expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    await h.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);
  }

  /** Makes every live enrolment due now and runs one worker pass. */
  async function runNow(sequenceId: string) {
    await asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.updateMany({ where: { sequenceId, status: 'ACTIVE' }, data: { nextRunAt: new Date(Date.now() - 1000) } }));
    return runner.runDue(500);
  }

  const enrollment = (sequenceId: string, leadId: string) =>
    asTenant(owner.tenantId, (tx) => tx.sequenceEnrollment.findFirstOrThrow({ where: { sequenceId, leadId }, include: { messages: { orderBy: { sentAt: 'asc' } } } }));

  it('keeps templates personal unless a marketing manager shares them, and previews merge fields', async () => {
    const t = (await http.post('/email-templates', { name: 'Intro', subject: 'Quick question for {{company|your team}}', body: 'Hi {{first_name|there}},\n\nI help teams like {{company}}. Details: https://example.com/case-study\n\n{{sender_first_name}}' }).expect(201)).body;
    ids.template = t.id;
    expect(t).toMatchObject({ shared: false, usedBy: 0 });
    await http.post('/email-templates', { name: 'Bad', subject: 'Hi {{nickname}}', body: 'x' }).expect(400);

    const member = await inviteMember(app, owner, 'member');
    expect((await api(member).get('/email-templates').expect(200)).body).toEqual([]);
    await api(member).post('/email-templates', { name: 'Shared', subject: 's', body: 'b', shared: true }).expect(403);
    await api(member).put(`/email-templates/${t.id}`, { name: 'Mine now', subject: 's', body: 'b' }).expect(404);
    await http.put(`/email-templates/${t.id}`, { name: 'Intro', subject: t.subject, body: t.body, shared: true }).expect(200);
    expect((await api(member).get('/email-templates').expect(200)).body.map((x: { name: string }) => x.name)).toEqual(['Intro']);

    const p = (await http.post('/email-templates/preview', { subject: t.subject, body: t.body, leadId: ids.ana }).expect(200)).body;
    expect(p.subject).toBe('Quick question for Buyer Co');
    expect(p.body).toContain('Hi Ana,');
    expect(p.missing).toEqual([]);
    const blank = (await http.post('/email-templates/preview', { subject: '{{job_title}}', body: 'Hi', leadId: ids.dee }).expect(200)).body;
    expect(blank.missing).toEqual(['job_title']);
  });

  it('builds a sequence and refuses enrolment until it is started and a mailbox is connected', async () => {
    const seq = (await http.post('/sequences', {
      name: 'Outbound Q4',
      steps: [
        { id: 'intro', type: 'email', delayDays: 0, templateId: ids.template },
        { id: 'check', type: 'condition', delayDays: 2, check: 'replied', ifYes: 'stop', ifNo: 'next' },
        { id: 'follow', type: 'email', delayDays: 0, subject: 'Re: {{company|your team}}', body: 'Just bumping this, {{first_name|there}}.' },
      ],
      settings: ALL_DAY,
    }).expect(201)).body;
    ids.seq = seq.id;
    expect(seq).toMatchObject({ status: 'DRAFT', rules: [{ on: 'replied' }, { on: 'bounced' }] });
    expect((await http.get('/email-templates').expect(200)).body[0].usedBy).toBe(1);
    await http.del(`/email-templates/${ids.template}`).expect(409);

    await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [ids.ana] }).expect(409);
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);
    const noMailbox = await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [ids.ana] }).expect(409);
    expect(noMailbox.body.error.code).toBe('NOT_CONNECTED');

    await connectGoogle(http);
    await http.post('/sequences/suppressions', { emails: ['Dee@NoCompany.test'] }).expect(201);
    const r = (await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [ids.ana, ids.ben, ids.cat, ids.noEmail, ids.optedOut, ids.dee] }).expect(200)).body;
    expect(r.enrolled).toBe(3);
    expect(r.skipped.map((s: { reason: string }) => s.reason).sort()).toEqual(['no_email', 'opted_out', 'suppressed']);
    const again = (await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [ids.ana] }).expect(200)).body;
    expect(again.skipped).toEqual([{ name: 'Ana Buyer', reason: 'already_enrolled' }]);
  });

  it('sends the first step from the sender mailbox with tracking and an unsubscribe link', async () => {
    const before = fixture.state.sent.length;
    expect(await runNow(ids.seq)).toBeGreaterThanOrEqual(3);
    expect(fixture.state.sent.length).toBe(before + 3);

    const e = await enrollment(ids.seq, ids.ana);
    expect(e).toMatchObject({ status: 'ACTIVE', stepIndex: 1 });
    expect(e.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000 - 60_000);
    expect(e.messages).toHaveLength(1);
    const msg = e.messages[0]!;
    expect(msg.subject).toBe('Quick question for Buyer Co');

    const mail = fixture.state.sent.slice(before).map((s) => decodeSent(s.body)).find((m) => m.headers.includes('To: ana@buyer.test'))!;
    const token = runner.signer.token(owner.tenantId, msg.id);
    expect(mail.headers).toContain(`List-Unsubscribe: <http://localhost:3000/api/v1/t/u/${token}>`);
    expect(mail.headers).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(mail.text).toContain('Hi Ana,');
    expect(mail.text).toContain(`unsubscribe here: http://localhost:3000/unsubscribe/${token}`);
    expect(mail.html).toContain(`/api/v1/t/o/${token}.gif`);
    expect(mail.html).toContain(`/api/v1/t/c/${token}?u=${encodeURIComponent('https://example.com/case-study')}`);

    // The send shows on the lead's timeline like any other email.
    const emails = (await http.get(`/emails?leadId=${ids.ana}`).expect(200)).body;
    expect(emails[0]).toMatchObject({ direction: 'OUTBOUND', subject: 'Quick question for Buyer Co' });
  });

  it('records opens and signed clicks, and rejects tampered links', async () => {
    const e = await enrollment(ids.seq, ids.cat);
    const token = runner.signer.token(owner.tenantId, e.messages[0]!.id);
    const pub = request(app.getHttpServer());

    const px = await pub.get(`/api/v1/t/o/${token}.gif`).expect(200);
    expect(px.headers['content-type']).toBe('image/gif');
    const url = 'https://example.com/case-study';
    const sig = runner.signer.urlSignature(token, url);
    const click = await pub.get(`/api/v1/t/c/${token}?u=${encodeURIComponent(url)}&s=${sig}`).expect(302);
    expect(click.headers.location).toBe(url);
    await pub.get(`/api/v1/t/c/${token}?u=${encodeURIComponent('https://evil.test')}&s=${sig}`).expect(400);
    // A forged token still gets the pixel but records nothing.
    await pub.get(`/api/v1/t/o/${token.slice(0, -2)}xx.gif`).expect(200);

    const after = await enrollment(ids.seq, ids.cat);
    expect(after.openedAt).not.toBeNull();
    expect(after.clickedAt).not.toBeNull();
    expect(after.messages[0]).toMatchObject({ openCount: 1, clickCount: 1 });
    expect(after.status).toBe('ACTIVE');
  });

  it('stops on a reply seen by mailbox sync and tells the sender, but ignores out-of-office notices', async () => {
    const now = Date.now();
    fixture.state.gmailMessages.push(
      { id: 'ooo-1', from: 'ana@buyer.test', to: 'rep@seller.test', subject: 'Automatic reply: Quick question', body: 'Away until Monday', internalDate: now + 1000 },
    );
    await http.post('/integrations/google/sync').expect(200);
    expect((await enrollment(ids.seq, ids.ana)).status).toBe('ACTIVE');

    fixture.state.gmailMessages.push({ id: 'reply-1', from: 'ana@buyer.test', to: 'rep@seller.test', subject: 'Re: Quick question for Buyer Co', body: 'Sure, call me.', internalDate: now + 2000 });
    await http.post('/integrations/google/sync').expect(200);
    const e = await enrollment(ids.seq, ids.ana);
    expect(e.status).toBe('REPLIED');
    expect(e.repliedAt).not.toBeNull();
    expect(e.messages[0]!.repliedAt).not.toBeNull();
    const notes = (await http.get('/notifications').expect(200)).body;
    const list = Array.isArray(notes) ? notes : notes.items;
    expect(list.some((n: { title: string }) => n.title === 'ana@buyer.test replied')).toBe(true);
  });

  it('treats a mailer-daemon notice as a bounce and adds the address to the do-not-email list', async () => {
    fixture.state.gmailMessages.push({
      id: 'bounce-1', from: 'mailer-daemon@googlemail.com', to: 'rep@seller.test', subject: 'Delivery Status Notification (Failure)',
      body: "Your message wasn't delivered to ben@gone.test because the address couldn't be found.", internalDate: Date.now() + 3000,
    });
    await http.post('/integrations/google/sync').expect(200);
    expect((await enrollment(ids.seq, ids.ben)).status).toBe('BOUNCED');
    const list = (await http.get('/sequences/suppressions').expect(200)).body;
    expect(list.find((s: { email: string }) => s.email === 'ben@gone.test')).toMatchObject({ reason: 'BOUNCED' });
  });

  it('moves through a condition step and sends the follow-up when there was no reply', async () => {
    await runNow(ids.seq); // condition: Cat did not reply → next
    let e = await enrollment(ids.seq, ids.cat);
    expect(e.stepIndex).toBe(2);
    await runNow(ids.seq); // follow-up email
    e = await enrollment(ids.seq, ids.cat);
    expect(e.status).toBe('COMPLETED');
    expect(e.messages.map((m) => m.stepId)).toEqual(['intro', 'follow']);
    expect(e.messages[1]!.subject).toBe('Re: Click Inc');

    const stats = (await http.get(`/sequences/${ids.seq}/step-stats`).expect(200)).body;
    expect(stats).toEqual([
      { stepId: 'intro', sent: 3, replied: 1, opened: 1, clicked: 1, bounced: 1 },
      { stepId: 'follow', sent: 1, replied: 0, opened: 0, clicked: 0, bounced: 0 },
    ]);
  });

  it('lets a recipient unsubscribe in one click without signing in', async () => {
    const e = await enrollment(ids.seq, ids.cat);
    const token = runner.signer.token(owner.tenantId, e.messages[1]!.id);
    const pub = request(app.getHttpServer());
    expect((await pub.get(`/api/v1/t/u/${token}`).expect(200)).body).toEqual({ valid: true, email: 'cat@click.test', workspace: 'Sequencers', unsubscribed: false });
    // Mail providers post the one-click form without an Origin header.
    expect((await pub.post(`/api/v1/t/u/${token}`).send('List-Unsubscribe=One-Click').expect(200)).body).toMatchObject({ unsubscribed: true });
    expect((await pub.get(`/api/v1/t/u/bad.token`).expect(200)).body).toEqual({ valid: false });

    const lead = (await http.get(`/leads/${ids.cat}`).expect(200)).body;
    expect(lead.marketingConsent).toBe('OPTED_OUT');
    const sup = (await http.get('/sequences/suppressions?search=cat@').expect(200)).body;
    expect(sup).toEqual([expect.objectContaining({ email: 'cat@click.test', reason: 'UNSUBSCRIBED' })]);
    // Removing an unsubscribe needs a reason.
    await http.post('/sequences/suppressions/cat@click.test/remove', {}).expect(400);
  });

  it('pauses instead of sending a gap when a merge field is empty, and honours the daily limit', async () => {
    const seq = (await http.post('/sequences', {
      name: 'Strict', settings: { ...ALL_DAY, dailyLimit: 1 },
      steps: [{ id: 'a', type: 'email', delayDays: 0, subject: 'For {{job_title}}', body: 'Hello' }],
    }).expect(201)).body;
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);
    const extra = (await http.post('/leads', { fullName: 'Eve Exec', email: 'eve@exec.test', jobTitle: 'CEO' }).expect(201)).body.lead.id;
    const fay = (await http.post('/leads', { fullName: 'Fay Founder', email: 'fay@exec.test', jobTitle: 'Founder' }).expect(201)).body.lead.id;
    const gus = (await http.post('/leads', { fullName: 'Gus', email: 'gus@exec.test' }).expect(201)).body.lead.id;
    await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [extra, fay, gus] }).expect(200);
    await runNow(seq.id);

    const rows = (await http.get(`/sequences/enrollments?sequenceId=${seq.id}`).expect(200)).body as { person: { name: string }; status: string; sent: number; lastError: string | null }[];
    const by = Object.fromEntries(rows.map((r) => [r.person.name, r]));
    expect(by['Gus']).toMatchObject({ status: 'PAUSED', sent: 0 });
    expect(by['Gus']!.lastError).toContain('Missing job_title');
    expect(rows.filter((r) => r.sent === 1)).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'ACTIVE' && r.sent === 0)).toHaveLength(1);
  });

  it('keeps sequences inside their workspace', async () => {
    const other = await registerUser(app, 'Outsiders');
    await api(other).get(`/sequences/${ids.seq}`).expect(404);
    expect((await api(other).get('/sequences').expect(200)).body).toEqual([]);
    expect((await api(other).get('/sequences/enrollments').expect(200)).body).toEqual([]);
    // A viewer can read but not build.
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).get('/sequences').expect(200);
    await api(viewer).post('/sequences', { name: 'Nope' }).expect(403);
  });
});
