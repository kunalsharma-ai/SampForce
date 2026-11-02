import type { INestApplication } from '@nestjs/common';
import type { InsightFeed, NextActionList, NotificationRow, TimelinePage } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** ADR 0052, batch 2: sentences the API composes, and stored notifications, read in the reader's language. */
describe('Composed sentences in the reader’s language', () => {
  let app: INestApplication;
  let owner: TestUser;
  let userId: string;
  let deal: string;
  const closeDate = ymd(-3);

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Sentences Co');
    userId = (await api(owner).get('/auth/me').expect(200)).body.user.id;
    const stages = (await api(owner).get('/pipelines').expect(200)).body[0].stages as { id: string; category: string }[];
    deal = (await api(owner).post('/deals', { name: 'Quiet Renewal', amount: 5000, stageId: stages.find((s) => s.category === 'OPEN')!.id, expectedCloseDate: closeDate }).expect(201)).body.id;
  });
  afterAll(async () => app.close());

  it('writes the insights feed in German, with whole sentences for one and many', async () => {
    const en = (await api(owner).get('/insights?scope=mine').expect(200)).body as InsightFeed;
    expect(en.items.find((i) => i.key === 'close_date_passed')?.title).toBe('1 open deal has a close date in the past');
    const de = (await api(owner).get('/insights?scope=mine').set('accept-language', 'de').expect(200)).body as InsightFeed;
    const late = de.items.find((i) => i.key === 'close_date_passed')!;
    expect(late.title).toBe('1 offene Verkaufschance hat ein Abschlussdatum in der Vergangenheit');
    expect(late.detail).toBe('Aktualisieren Sie das Datum oder die Phase, damit die Prognose stimmt.');
    // Money in the reader's number format.
    expect(de.items.find((i) => i.key === 'pipeline_created')?.title).toMatch(/^1 neue Verkaufschance im Wert von 5\.000/);
  });

  it('writes next best actions and the timeline in the reader’s language, keeping record names as they are', async () => {
    const es = (await api(owner).get('/next-actions').set('accept-language', 'es').expect(200)).body as NextActionList;
    // One item per record: the deal's highest-ranked rule wins (here the passed close date or the risk it causes).
    const item = es.items.find((i) => i.record.id === deal)!;
    expect(item.record.name).toBe('Quiet Renewal');
    expect(['Confirma una nueva fecha de cierre para Quiet Renewal', 'Planifica el siguiente paso para Quiet Renewal']).toContain(item.title);
    expect(item.reason).toMatch(/^(Se esperaba cerrarla el \d{4}-\d{2}-\d{2}\.|Salud \d+\/100: .+\.)$/);
    const timeline = (await api(owner).get(`/timeline/deal/${deal}`).set('accept-language', 'fr').expect(200)).body as TimelinePage;
    expect(timeline.items.find((i) => i.kind === 'created')?.title).toBe('Quiet Renewal a été ajouté');
  });

  it('shows stored notifications in the reader’s language, translating signal lists inside them', async () => {
    await asTenant(owner.tenantId, (tx) =>
      tx.notification.createMany({
        data: [
          { tenantId: owner.tenantId, userId, type: 'contract.renewal_due', title: 'Renewal due: C-0007', body: `Acme MSA ends in 1 day (${closeDate}).` },
          { tenantId: owner.tenantId, userId, type: 'deal.high_risk', title: 'Quiet Renewal is at high risk', body: 'Health 35/100: Close date has passed, No open task.' },
        ],
      }),
    );
    const fr = (await api(owner).get('/notifications').set('accept-language', 'fr').expect(200)).body.items as NotificationRow[];
    expect(fr.find((n) => n.type === 'contract.renewal_due')).toMatchObject({ title: 'Renouvellement à prévoir : C-0007', body: `Acme MSA se termine dans 1 jour (${closeDate}).` });
    const es = (await api(owner).get('/notifications').set('accept-language', 'es').expect(200)).body.items as NotificationRow[];
    expect(es.find((n) => n.type === 'deal.high_risk')).toMatchObject({
      title: 'Quiet Renewal está en riesgo alto',
      body: 'Salud 35/100: La fecha de cierre ya pasó, Sin tareas abiertas.',
    });
    const en = (await api(owner).get('/notifications').expect(200)).body.items as NotificationRow[];
    expect(en.find((n) => n.type === 'deal.high_risk')?.title).toBe('Quiet Renewal is at high risk');
  });
  it('names the starter pipeline in the language of the person who registers the workspace', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/register')
      .set('origin', 'http://localhost:3000')
      .set('accept-language', 'es')
      .send({ name: 'Ana', email: `es-${Date.now()}@example.com`, password: 'correcthorse1', organizationName: 'Ventas SA' })
      .expect(201);
    const pipelines = (await agent.get('/api/v1/pipelines').expect(200)).body as { name: string; stages: { name: string }[] }[];
    expect(pipelines[0]!.name).toBe('Pipeline de ventas');
    expect(pipelines[0]!.stages.map((s) => s.name)).toContain('Calificación');
    // Owner registered without a language header: English, as before.
    expect(((await api(owner).get('/pipelines').expect(200)).body as { name: string }[])[0]!.name).toBe('Sales Pipeline');
  });
});
