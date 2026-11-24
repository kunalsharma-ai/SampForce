import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AiFixture, createAiFixture } from './fixtures/ai-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** The AI sales email assistant on the company page and the organisation's sales profile (ADR 0077). */
describe('company sales email assistant', () => {
  let app: INestApplication;
  let ai: AiFixture;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let companyId: string;
  let priyaId: string;
  const saved: Record<string, string | undefined> = {};

  /** The input the model was given for the last company email. */
  const lastInput = () => {
    const req = [...ai.requests].reverse().find((r) => r.body.system?.startsWith('You write a sales email from one organisation'));
    const m = req!.body.messages[0]!.content;
    const text = typeof m === 'string' ? m : m.map((b) => b.text ?? '').join('');
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  };

  beforeAll(async () => {
    ai = await createAiFixture();
    for (const k of ['ANTHROPIC_API_KEY', 'AI_API_BASE_URL']) saved[k] = process.env[k];
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_API_BASE_URL = ai.url;
    app = await startApp();
    owner = await registerUser(app, 'Insight Panels');
    http = api(owner);
    const res = (
      await http
        .post('/company-leads', {
          company: { name: 'Contoso Foods', industry: 'Food manufacturing', city: 'Lyon', country: 'FR', emails: [{ value: 'hello@contoso-foods.example' }] },
          employees: [{ firstName: 'Priya', lastName: 'Nair', jobTitle: 'Head of Insights', emails: [{ value: 'priya@contoso-foods.example' }] }],
        })
        .expect(201)
    ).body;
    companyId = res.company.id;
    [priyaId] = res.employeeIds;
  });

  afterAll(async () => {
    await app.close();
    await ai.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('keeps one sales profile for the organisation, changed only by the Super Workspace', async () => {
    const empty = (await http.get('/tenants/current/sales-profile').expect(200)).body;
    expect(empty).toMatchObject({ companyName: '', services: [], valueProposition: '', workspaceName: 'Insight Panels', editable: true, updatedAt: null });

    const saved = (
      await http
        .put('/tenants/current/sales-profile', {
          companyName: 'Insight Panels Ltd',
          about: 'A market research panel company.',
          services: ['Online surveys', 'B2B panels'],
          valueProposition: 'Verified respondents in 40 countries, delivered within a week.',
          website: 'https://insight-panels.example',
          signature: 'Book a call: https://insight-panels.example/meet',
        })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ companyName: 'Insight Panels Ltd', services: ['Online surveys', 'B2B panels'], updatedBy: { name: expect.any(String) } });
    await http.put('/tenants/current/sales-profile', { website: 'not a site' }).expect(400);
    await http.put('/tenants/current/sales-profile', { services: [], extra: 1 }).expect(400);

    // A member reads it but cannot change it.
    const rep = await inviteMember(app, owner, 'member');
    expect((await api(rep).get('/tenants/current/sales-profile').expect(200)).body).toMatchObject({ companyName: 'Insight Panels Ltd', editable: false });
    await api(rep).put('/tenants/current/sales-profile', { companyName: 'Mine' }).expect(403);

    // An administrator in a Manager Workspace uses it as it is.
    const admin = await inviteMember(app, owner, 'admin');
    await asTenant(owner.tenantId, async (tx) => {
      const node = await tx.workspaceNode.create({ data: { tenantId: owner.tenantId, level: 'MANAGER', name: 'Sales East', nameKey: 'sales east', designation: 'Sales Manager', features: [] } });
      await tx.membership.updateMany({ where: { tenantId: owner.tenantId, userId: admin.userId }, data: { workspaceNodeId: node.id } });
    });
    await api(admin).put('/tenants/current/sales-profile', { companyName: 'Mine' }).expect(403);
    expect((await http.get('/tenants/current/sales-profile').expect(200)).body.companyName).toBe('Insight Panels Ltd');

    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action: 'sales_profile.updated' } }));
    expect(audit).toHaveLength(1);
    expect((audit[0]!.metadata as { changed: string[] }).changed).toEqual(expect.arrayContaining(['companyName', 'services', 'valueProposition']));
  });

  it('writes to a named employee for the organisation in its profile, with follow-ups and its signature', async () => {
    const d = (
      await http.post(`/companies/${companyId}/ai-email`, { contactId: priyaId, purpose: 'meeting_request', cta: 'book_call', tone: 'friendly', followUps: 2, objective: 'their 2027 consumer tracker' }).expect(200)
    ).body;
    expect(d.subject).toBe('Insight Panels Ltd for Contoso Foods');
    expect(d.body).toContain('Hi Priya,');
    expect(d.body).toContain('Online surveys and B2B panels');
    expect(d.body).toContain('Verified respondents in 40 countries');
    expect(d.body.trimEnd().endsWith('Book a call: https://insight-panels.example/meet')).toBe(true);
    expect(d.followUps).toHaveLength(2);
    // Wait times are kept between 2 and 14 days.
    expect(d.followUps[0].waitDays).toBe(2);
    expect(d.followUps[1].body).toContain('Book a call');
    expect(d.checkBeforeSending).toContain('Fill in [proposed time]');
    expect(d).toMatchObject({
      to: 'priya@contoso-foods.example',
      recipient: { contactId: priyaId, name: 'Priya Nair', jobTitle: 'Head of Insights', optedOut: false, emailProblem: false },
      sender: { company: 'Insight Panels Ltd', gaps: [] },
      runId: expect.any(String),
    });

    const input = lastInput();
    expect(input.sender).toMatchObject({ organisation: 'Insight Panels Ltd', services: ['Online surveys', 'B2B panels'] });
    expect(input.company).toMatchObject({ name: 'Contoso Foods', city: 'Lyon', country: 'FR' });
    expect(input.settings).toMatchObject({ purpose: 'Ask for a meeting', followUps: 2, objective: 'their 2027 consumer tracker' });
    // Nothing about any other organisation is built in.
    expect(JSON.stringify(input)).not.toMatch(/Frequent Research/i);

    const run = await asTenant(owner.tenantId, (tx) => tx.aiRun.findFirst({ where: { tenantId: owner.tenantId, id: d.runId } }));
    expect(run).toMatchObject({ agent: 'email_assistant', entityType: 'company', entityId: companyId, status: 'SUCCEEDED' });
  });

  it('greets a role without inventing a name, uses the company email, and warns about an opted-out employee', async () => {
    const d = (await http.post(`/companies/${companyId}/ai-email`, { recipientType: 'procurement', cta: 'reply' }).expect(200)).body;
    expect(d.body.startsWith('Hello,')).toBe(true);
    expect(d).toMatchObject({ recipient: null, to: 'hello@contoso-foods.example', followUps: [] });
    expect(lastInput().recipient).toEqual({ role: 'Procurement', name: null });

    await asTenant(owner.tenantId, (tx) => tx.contact.update({ where: { id: priyaId }, data: { marketingConsent: 'OPTED_OUT', emailStatus: 'bounced' } }));
    const w = (await http.post(`/companies/${companyId}/ai-email`, { contactId: priyaId }).expect(200)).body;
    expect(w.recipient).toMatchObject({ optedOut: true, emailProblem: true });
  });

  it('says what the sales profile lacks, and refuses what the caller may not do', async () => {
    const other = await registerUser(app, 'Blank Org');
    const res = (await api(other).post('/company-leads', { company: { name: 'Fabrikam' } }).expect(201)).body;
    const d = (await api(other).post(`/companies/${res.company.id}/ai-email`, {}).expect(200)).body;
    expect(d.sender).toEqual({ company: 'Blank Org', gaps: ['services', 'valueProposition'] });
    expect(d.body).toContain('[what we offer]');

    // Another organisation's company and employee are not found.
    await api(other).post(`/companies/${companyId}/ai-email`, {}).expect(404);
    await api(other).post(`/companies/${res.company.id}/ai-email`, { contactId: priyaId }).expect(404);
    await http.post(`/companies/${companyId}/ai-email`, { purpose: 'spam' }).expect(400);
  });
});
