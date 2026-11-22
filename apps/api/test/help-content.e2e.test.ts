import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, inviteMember, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

type Content = {
  categories: { id: string; parentId: string | null }[];
  articles: { key: string; id: string; title: { en: string }; builtinKey: string | null; updatedAt: string }[];
  hidden: string[];
  stats: Record<string, { views: number; helpful: number; notHelpful: number }>;
  builtinUpdatedAt: string;
  myFeedback: Record<string, boolean>;
};

/*
 * Help Center content managed in the Console (ADR 0073): administrators write, publish, archive and restore articles
 * and topics, edit or hide built-in help, and read what people said; readers only get what is meant for them.
 */
describe('help center content from the Console', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser;
  let other: TestUser;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  const db = ownerClient();
  const tag = randomUUID().slice(0, 8);

  const login = async (role: 'ADMIN' | 'SUPPORT') => {
    const email = `help-${role.toLowerCase()}-${tag}@platform.test`;
    const client = appClient();
    await client.platformOperator.create({ data: { email, name: `${role} ${tag}`, passwordHash: await new PasswordService().hash('operator-password-1'), role } });
    await client.$disconnect();
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password: 'operator-password-1' }).expect(200);
    return agent;
  };
  const as = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator/help${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator/help${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator/help${url}`).set('origin', ORIGIN).send(body),
  });
  const content = async (who: TestUser) => (await api(who).get('/help/content').expect(200)).body as Content;
  const article = (over: object = {}) => ({
    kind: 'GUIDE',
    categoryId: 'deals',
    title: { en: `Close a quarter cleanly ${tag}`, de: `Quartal sauber abschließen ${tag}` },
    summary: { en: 'What to check before the quarter ends.' },
    body: { en: '## Before the last week\n\n1. Open Deals and filter to this quarter.\n2. Move stale deals to Lost.\n\n- Ask your manager before changing amounts.' },
    ...over,
  });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    owner = await registerUser(app, 'Help Content Client');
    member = await inviteMember(app, owner, 'member');
    other = await registerUser(app, 'Another Content Client');
    admin = await login('ADMIN');
    support = await login('SUPPORT');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('writes a draft, publishes it to readers, keeps every version and restores one', async () => {
    const A = as(admin);
    await as(support).post('/articles', article()).expect(403);
    await A.post('/articles', article({ categoryId: 'no-such-topic' })).expect(400);
    await A.post('/articles', article({ videoUrl: 'http://example.com/clip' })).expect(400);

    const draft = (await A.post('/articles', article({ videoUrl: 'https://videos.example.com/close-quarter' })).expect(201)).body;
    expect(draft).toMatchObject({ status: 'DRAFT', version: 1, key: `article:${draft.id}`, versions: [{ version: 1, note: 'First draft', operator: `ADMIN ${tag}` }] });
    expect((await content(owner)).articles.map((a) => a.id)).not.toContain(draft.id);

    await A.post(`/articles/${draft.id}/publish`).expect(200);
    const seen = (await content(owner)).articles.find((a) => a.id === draft.id);
    expect(seen).toMatchObject({ key: `article:${draft.id}`, title: { en: `Close a quarter cleanly ${tag}`, de: `Quartal sauber abschließen ${tag}` }, updatedAt: expect.any(String) });

    const edited = (await A.put(`/articles/${draft.id}`, article({ title: { en: `Close the quarter ${tag}` }, note: 'Shorter title' })).expect(200)).body;
    expect(edited).toMatchObject({ status: 'PUBLISHED', version: 2 });
    const restored = (await A.post(`/articles/${draft.id}/versions/1/restore`).expect(200)).body;
    expect(restored).toMatchObject({ version: 3, title: { en: `Close a quarter cleanly ${tag}` } });
    expect(restored.versions.map((v: { version: number; note: string | null }) => [v.version, v.note])).toEqual([
      [3, 'Restored version 1'],
      [2, 'Shorter title'],
      [1, 'First draft'],
    ]);
    // Support staff read but do not write.
    expect((await as(support).get(`/articles/${draft.id}`).expect(200)).body.version).toBe(3);
    await as(support).post(`/articles/${draft.id}/archive`).expect(403);

    await A.post(`/articles/${draft.id}/archive`).expect(200);
    expect((await content(owner)).articles.map((a) => a.id)).not.toContain(draft.id);
    const log = (await db.platformAuditLog.findMany({ where: { action: { startsWith: 'help_article.' } } })).filter((l) => (l.metadata as { articleId?: string } | null)?.articleId === draft.id);
    expect(log.map((l) => l.action).sort()).toEqual(['help_article.archived', 'help_article.created', 'help_article.published', 'help_article.restored', 'help_article.updated']);
  });

  it('edits and hides built-in help', async () => {
    const A = as(admin);
    await A.post('/articles', article({ kind: 'FAQ', builtinKey: 'faq:no.such' })).expect(400);
    const edit = (await A.post('/articles', article({ kind: 'FAQ', builtinKey: 'faq:deals.move', title: { en: 'How do I move a deal to the next stage?' }, summary: { en: `Drag it, or use Move on the deal ${tag}.` } })).expect(201)).body;
    await A.post('/articles', article({ kind: 'FAQ', builtinKey: 'faq:deals.move' })).expect(409);
    await A.post(`/articles/${edit.id}/publish`).expect(200);
    const hide = (await A.post('/articles', article({ kind: 'FAQ', builtinKey: 'faq:deals.pipelines' })).expect(201)).body;
    await A.post(`/articles/${hide.id}/archive`).expect(200);

    const c = await content(owner);
    expect(c.articles.find((a) => a.key === 'faq:deals.move')).toMatchObject({ builtinKey: 'faq:deals.move' });
    expect(c.hidden).toContain('faq:deals.pipelines');
    // The mobile app's GET /help leaves out both built-in answers and carries the edit instead.
    const help = (await api(owner).get('/help').expect(200)).body as { faqs: { id: string }[]; content: Content };
    expect(help.faqs.map((f) => f.id)).not.toContain('deals.move');
    expect(help.faqs.map((f) => f.id)).not.toContain('deals.pipelines');
    expect(help.content.articles.map((a) => a.key)).toContain('faq:deals.move');
  });

  it('shows an article only to the levels, roles, clients and plans it is meant for', async () => {
    const A = as(admin);
    const publish = async (over: object) => {
      const a = (await A.post('/articles', article({ title: { en: `Targeted ${randomUUID().slice(0, 6)}` }, ...over })).expect(201)).body;
      await A.post(`/articles/${a.id}/publish`).expect(200);
      return a.id as string;
    };
    const managersOnly = await publish({ levels: ['MANAGER'] });
    const ownersOnly = await publish({ roleKeys: ['owner'] });
    const thisClient = await publish({ tenantIds: [owner.tenantId] });
    const unknownClient = await A.post('/articles', article({ tenantIds: [randomUUID()] })).expect(400);
    expect(unknownClient.body.error.details[0].path).toBe('tenantIds');

    const ownerSees = (await content(owner)).articles.map((a) => a.id);
    const memberSees = (await content(member)).articles.map((a) => a.id);
    const otherSees = (await content(other)).articles.map((a) => a.id);
    expect(ownerSees).not.toContain(managersOnly);
    expect(ownerSees).toEqual(expect.arrayContaining([ownersOnly, thisClient]));
    expect(memberSees).not.toContain(ownersOnly);
    expect(memberSees).toContain(thisClient);
    expect(otherSees).not.toContain(thisClient);
  });

  it('counts readings and "Was this helpful?" answers, and lets the Console review comments', async () => {
    const key = 'faq:account.password';
    await api(owner).post('/help/views', { articleKey: key }).expect(200);
    const viewed = (await api(owner).post('/help/views', { articleKey: key }).expect(200)).body;
    expect(viewed.views).toBeGreaterThanOrEqual(2);
    await api(owner).post('/help/views', { articleKey: 'faq:no.such' }).expect(404);
    await api(owner).post('/help/views', { articleKey: 'not a key' }).expect(400);

    const before = (await content(owner)).stats[key] ?? { helpful: 0, notHelpful: 0 };
    const yes = (await api(owner).post('/help/feedback', { articleKey: key, helpful: true }).expect(200)).body;
    expect(yes.stats).toMatchObject({ helpful: before.helpful + 1, notHelpful: before.notHelpful });
    const no = (await api(owner).post('/help/feedback', { articleKey: key, helpful: false, comment: `The reset email never came ${tag}.` }).expect(200)).body;
    expect(no.stats).toMatchObject({ helpful: before.helpful, notHelpful: before.notHelpful + 1 });
    expect((await content(owner)).myFeedback[key]).toBe(false);
    expect((await content(member)).myFeedback[key]).toBeUndefined();

    const list = (await as(support).get('/feedback?helpful=false&open=true').expect(200)).body as { id: string; comment: string; tenant: { name: string }; person: string }[];
    const mine = list.find((f) => f.comment === `The reset email never came ${tag}.`)!;
    expect(mine).toMatchObject({ tenant: { name: 'Help Content Client' }, person: expect.any(String) });
    await as(support).post(`/feedback/${mine.id}/review`).expect(200);
    expect(((await as(support).get('/feedback?open=true').expect(200)).body as { id: string }[]).map((f) => f.id)).not.toContain(mine.id);
    // A workspace cannot read the Console's lists.
    await owner.agent.get('/api/v1/operator/help/feedback').expect(401);
  });

  it('adds topics and subtopics, and serves pictures inside articles', async () => {
    const A = as(admin);
    await A.put('/categories', { id: 'deals', title: { en: 'Clash' } }).expect(400);
    await A.put('/categories', { id: `onboarding-${tag}`, parentId: 'missing-topic', title: { en: 'Onboarding' } }).expect(400);
    const topic = (await A.put('/categories', { id: `onboarding-${tag}`, parentId: 'start', title: { en: 'Onboarding', es: 'Incorporación' }, description: { en: 'Your first week.' }, icon: 'rocket', tone: 2 }).expect(200)).body;
    expect(topic).toMatchObject({ id: `onboarding-${tag}`, parentId: 'start', archivedAt: null });

    await admin.post('/api/v1/operator/help/media?name=evil.html').set('origin', ORIGIN).set('content-type', 'text/html').send(Buffer.from('<script>')).expect(400);
    const pic = (await admin.post('/api/v1/operator/help/media?name=board.png').set('origin', ORIGIN).set('content-type', 'image/png').send(Buffer.from('png-bytes')).expect(201)).body;
    expect(pic.markdown).toBe(`![board.png](media:${pic.id})`);
    await A.post('/articles', article({ categoryId: `onboarding-${tag}`, body: { en: `![x](media:${randomUUID()})` } })).expect(400);
    const a = (await A.post('/articles', article({ categoryId: `onboarding-${tag}`, body: { en: `Look at the board:\n\n${pic.markdown}` } })).expect(201)).body;
    await A.post(`/articles/${a.id}/publish`).expect(200);

    const c = await content(owner);
    expect(c.categories.map((x) => x.id)).toContain(`onboarding-${tag}`);
    expect(c.articles.find((x) => x.id === a.id)).toBeTruthy();
    const img = await owner.agent.get(`/api/v1/help/media/${pic.id}`).buffer(true).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['content-disposition']).toBe('inline');
    await request(app.getHttpServer()).get(`/api/v1/help/media/${pic.id}`).expect(401);

    await A.post(`/categories/onboarding-${tag}/archive`).expect(200);
    expect((await content(owner)).categories.map((x) => x.id)).not.toContain(`onboarding-${tag}`);
  });
});
