import type { INestApplication } from '@nestjs/common';
import type { EmailDesign, EmailTemplateRow, TemplatePreview } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SequenceRunner } from '../src/sequences/sequence-runner.service';
import {
  startProviderFixture,
  providerEnv,
  type ProviderFixture,
} from './fixtures/provider-fixture';
import { api, asTenant, registerUser, startApp, type TestUser } from './helpers';

/** Decodes what the Gmail adapter sent: headers plus the text and HTML parts. */
function decodeSent(body: string): { headers: string; text: string; html: string } {
  const mime = Buffer.from((JSON.parse(body) as { raw: string }).raw, 'base64url').toString();
  const [headers = '', ...rest] = mime.split('\r\n\r\n');
  const parts = rest.join('\r\n\r\n');
  const chunks = [
    ...parts.matchAll(
      /Content-Type: text\/(plain|html); charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g,
    ),
  ];
  const get = (t: string) =>
    Buffer.from(
      (chunks.find((c) => c[1] === t)?.[2] ?? '').replace(/\r\n/g, ''),
      'base64',
    ).toString();
  if (!chunks.length)
    return {
      headers,
      text: Buffer.from(parts.replace(/\r\n/g, ''), 'base64').toString(),
      html: '',
    };
  return { headers, text: get('plain'), html: get('html') };
}

const ALL_DAY = {
  sendDays: [0, 1, 2, 3, 4, 5, 6],
  sendStart: '00:00',
  sendEnd: '23:59',
  timezone: 'UTC',
  dailyLimit: 50,
  trackOpens: true,
  trackClicks: true,
};

const DESIGN = {
  theme: { accent: '#0f766e' },
  blocks: [
    { id: 'h', type: 'header', title: 'Northwind Research' },
    {
      id: 't',
      type: 'text',
      text: 'Hi {{first_name|there}},\n\nHere is the panel we discussed for {{company}}.',
    },
    {
      id: 'p',
      type: 'product',
      name: 'Usage panel',
      price: '$8 per complete',
      url: 'https://northwind.test/panel',
      buttonLabel: 'See the panel',
    },
    {
      id: 'r',
      type: 'pricing',
      title: 'Options',
      rows: [
        { label: 'Starter', price: '$2,000' },
        { label: 'Pro', price: '$6,000', note: 'Weekly reports' },
      ],
    },
    { id: 'b', type: 'button', label: 'Book a call', url: '{{var.booking_link}}' },
    { id: 's', type: 'signature', name: '{{sender_name}}', email: '{{sender_email}}' },
  ],
};

/** Design spec Part 9 email template designer (ADR 0050): designed templates are stored, previewed and sent as HTML. */
describe('designed email templates', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let runner: SequenceRunner;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let template: EmailTemplateRow;
  let leadId: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    runner = app.get(SequenceRunner);
    owner = await registerUser(app, 'Designers');
    await asTenant(owner.tenantId, (tx) =>
      tx.subscription.update({
        where: { tenantId: owner.tenantId },
        data: { planCode: 'growth', status: 'ACTIVE', seats: 20 },
      }),
    );
    http = api(owner);
    const { url } = (await http.post('/integrations/google/connect').expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    await http
      .get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`)
      .expect(302);
    leadId = (
      await http
        .post('/leads', {
          fullName: 'Ava <b>Stone</b>',
          companyName: 'Stone & Sons',
          email: 'ava@stone.test',
        })
        .expect(201)
    ).body.lead.id;
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('stores a design with its plain-text version, and checks the merge fields and links inside it', async () => {
    const missingVar = await http
      .post('/email-templates', {
        name: 'Panel offer',
        subject: 'A panel for {{company}}',
        design: DESIGN,
      })
      .expect(400);
    expect(missingVar.body.error.message).toContain('{{var.booking_link}}');
    await http
      .put('/email-variables', {
        key: 'booking_link',
        label: 'Booking link',
        value: 'https://cal.northwind.test/sam',
      })
      .expect(200);

    const unsafe = {
      ...DESIGN,
      blocks: [{ id: 'x', type: 'button', label: 'Go', url: 'javascript:alert(1)' }],
    };
    await http
      .post('/email-templates', { name: 'Unsafe', subject: 'Hi', design: unsafe })
      .expect(400);
    await http
      .post('/email-templates', {
        name: 'Unknown',
        subject: 'Hi',
        design: { blocks: [{ id: 'x', type: 'text', text: 'Hi {{nickname}}' }] },
      })
      .expect(400);

    template = (
      await http
        .post('/email-templates', {
          name: 'Panel offer',
          subject: 'A panel for {{company}}',
          design: DESIGN,
        })
        .expect(201)
    ).body as EmailTemplateRow;
    expect(template.design?.blocks.map((b) => b.type)).toEqual([
      'header',
      'text',
      'product',
      'pricing',
      'button',
      'signature',
    ]);
    expect(template.design?.theme).toMatchObject({
      accent: '#0f766e',
      surface: '#ffffff',
      font: 'sans',
    });
    expect(template.body).toContain('Hi {{first_name|there}},');
    expect(template.body).toContain('Book a call: {{var.booking_link}}');
    expect(template.body).toContain('Pro: $6,000 (Weekly reports)');

    // Turning it back into a plain-text template drops the design.
    const copy = (await http.post(`/email-templates/${template.id}/duplicate`).expect(201))
      .body as EmailTemplateRow;
    expect(copy.design).toEqual(template.design);
    const plain = (
      await http
        .put(`/email-templates/${copy.id}`, {
          name: copy.name,
          subject: copy.subject,
          body: 'Just text now.',
          design: null,
        })
        .expect(200)
    ).body as EmailTemplateRow;
    expect(plain).toMatchObject({ design: null, body: 'Just text now.' });
    const listed = (await http.get('/email-templates').expect(200)).body as EmailTemplateRow[];
    expect(listed.find((t) => t.id === template.id)?.design?.blocks).toHaveLength(6);
  });

  it('previews the design as HTML for a real lead, escaping what the lead record holds', async () => {
    const p = (
      await http
        .post('/email-templates/preview', {
          subject: template.subject,
          design: template.design,
          leadId,
        })
        .expect(200)
    ).body as TemplatePreview;
    expect(p.subject).toBe('A panel for Stone & Sons');
    expect(p.html).toContain('Here is the panel we discussed for Stone &amp; Sons.');
    expect(p.html).toContain('href="https://cal.northwind.test/sam"');
    expect(p.html).not.toContain('<b>Stone</b>');
    expect(p.body).toContain('Book a call: https://cal.northwind.test/sam');
    expect(p.missing).toEqual([]);
    const blank = (
      await http
        .post('/email-templates/preview', { subject: 'Hi', design: template.design })
        .expect(200)
    ).body as TemplatePreview;
    expect(blank.html).toContain('Hi there,');
    expect(blank.missing).toEqual(['company']);
  });

  it('sends a sequence step that uses the template as HTML with tracked links, and a step with its own text as plain text', async () => {
    const seq = (
      await http
        .post('/sequences', {
          name: 'Designed outreach',
          steps: [
            { id: 'one', type: 'email', delayDays: 0, templateId: template.id },
            {
              id: 'two',
              type: 'email',
              delayDays: 0,
              templateId: template.id,
              body: 'Own words, {{first_name|there}}.',
            },
          ],
          rules: [],
          settings: ALL_DAY,
        })
        .expect(201)
    ).body;
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);

    const test = (
      await http.post(`/sequences/${seq.id}/test-send`, { stepId: 'one', leadId }).expect(200)
    ).body;
    expect(test.subject).toBe('[Test] A panel for Stone & Sons');
    const testMail = decodeSent(fixture.state.sent.at(-1)!.body);
    expect(testMail.html).toContain('Northwind Research');
    expect(testMail.html).toContain('sent only to you');
    expect(testMail.html).not.toContain('/api/v1/t/');

    await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [leadId] }).expect(200);
    const due = () =>
      asTenant(owner.tenantId, (tx) =>
        tx.sequenceEnrollment.updateMany({
          where: { status: 'ACTIVE', sequenceId: seq.id },
          data: { nextRunAt: new Date(Date.now() - 1000) },
        }),
      );
    await due();
    await runner.runDue(50);
    const [msg] = await asTenant(owner.tenantId, (tx) =>
      tx.sequenceMessage.findMany({ where: { enrollment: { sequenceId: seq.id } } }),
    );
    const token = runner.signer.token(owner.tenantId, msg!.id);
    const mail = decodeSent(fixture.state.sent.at(-1)!.body);
    expect(mail.headers).toContain('To: ava@stone.test');
    expect(mail.html).toContain('bgcolor="#0f766e"');
    expect(mail.html).toContain(
      `/api/v1/t/c/${token}?u=${encodeURIComponent('https://cal.northwind.test/sam')}`,
    );
    expect(mail.html).toContain(
      `/api/v1/t/c/${token}?u=${encodeURIComponent('https://northwind.test/panel')}`,
    );
    expect(mail.html).toContain(`/api/v1/t/o/${token}.gif`);
    expect(mail.html).toContain(`href="http://localhost:3000/unsubscribe/${token}"`);
    expect(mail.html).toContain('Stone &amp; Sons');
    expect(mail.text).toContain('Hi Ava,');
    expect(mail.text).toContain(`unsubscribe here: http://localhost:3000/unsubscribe/${token}`);

    await due();
    await runner.runDue(50);
    const second = decodeSent(fixture.state.sent.at(-1)!.body);
    expect(second.text).toContain('Own words, Ava.');
    expect(second.html).not.toContain('Northwind Research');
  });

  it('pauses instead of sending a designed email with an empty field and no fallback', async () => {
    const d: EmailDesign = {
      ...(template.design as EmailDesign),
      blocks: [{ id: 't', type: 'text', text: 'For {{job_title}}', align: 'left' }],
    };
    const t = (
      await http
        .post('/email-templates', { name: 'Needs title', subject: 'Hello', design: d })
        .expect(201)
    ).body as EmailTemplateRow;
    const seq = (
      await http
        .post('/sequences', {
          name: 'Gap',
          steps: [{ id: 'one', type: 'email', delayDays: 0, templateId: t.id }],
          rules: [],
          settings: ALL_DAY,
        })
        .expect(201)
    ).body;
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);
    await http.post(`/sequences/${seq.id}/enroll`, { leadIds: [leadId] }).expect(200);
    await asTenant(owner.tenantId, (tx) =>
      tx.sequenceEnrollment.updateMany({
        where: { status: 'ACTIVE', sequenceId: seq.id },
        data: { nextRunAt: new Date(Date.now() - 1000) },
      }),
    );
    const before = fixture.state.sent.length;
    await runner.runDue(50);
    expect(fixture.state.sent.length).toBe(before);
    const e = await asTenant(owner.tenantId, (tx) =>
      tx.sequenceEnrollment.findFirst({ where: { sequenceId: seq.id } }),
    );
    expect(e).toMatchObject({ status: 'PAUSED' });
    expect(e!.lastError).toContain('job_title');
  });
});
