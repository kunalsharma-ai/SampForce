import type { INestApplication } from '@nestjs/common';
import { NOTIFICATION_CATEGORIES, notificationCategoryOf } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { api, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/*
 * Notifications for every new event (redesign R10, ADR 0094): a deal someone else marks lost tells its owner, and the
 * task and team-status notifications have their own categories, so their sound can be switched off on its own.
 */
describe('redesign notifications', () => {
  let app: INestApplication;
  let worker: WorkerService;
  let owner: TestUser;
  let rep: TestUser & { userId: string };

  beforeAll(async () => {
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Lost Deal Research');
    rep = await inviteMember(app, owner, 'member');
  });
  afterAll(async () => app.close());

  it('tells the owner when someone else marks their deal lost, and not the person who did it', async () => {
    const pipeline = ((await api(owner).get('/pipelines').expect(200)).body as { isDefault: boolean; stages: { id: string; category: string }[] }[]).find((p) => p.isDefault)!;
    const open = pipeline.stages.find((s) => s.category === 'OPEN')!.id;
    const lost = pipeline.stages.find((s) => s.category === 'LOST')!.id;
    const deal = (await api(rep).post('/deals', { name: 'Contoso tracker wave 2', amount: 4000, currency: 'USD', stageId: open, ownerId: rep.userId, customFields: {} }).expect(201)).body;

    await api(owner).post(`/deals/${deal.id}/move`, { stageId: lost, lossReason: 'Went with a cheaper panel' }).expect(200);
    await worker.drain();

    const repNotes = (await api(rep).get('/notifications?limit=100').expect(200)).body.items as { type: string; title: string; link: string | null }[];
    const n = repNotes.find((x) => x.type === 'deal.lost');
    expect(n).toMatchObject({ title: 'Deal lost: Contoso tracker wave 2' });
    expect(n!.link).toContain(deal.id);
    const ownerNotes = (await api(owner).get('/notifications?limit=100').expect(200)).body.items as { type: string }[];
    expect(ownerNotes.some((x) => x.type === 'deal.lost')).toBe(false);

    // The owner moving their own deal to lost tells nobody.
    const own = (await api(rep).post('/deals', { name: 'Own deal', amount: 100, currency: 'USD', stageId: open, ownerId: rep.userId, customFields: {} }).expect(201)).body;
    await api(rep).post(`/deals/${own.id}/move`, { stageId: lost, lossReason: 'No budget' }).expect(200);
    await worker.drain();
    const after = (await api(rep).get('/notifications?limit=100').expect(200)).body.items as { type: string; title: string }[];
    expect(after.filter((x) => x.type === 'deal.lost').map((x) => x.title)).toEqual(['Deal lost: Contoso tracker wave 2']);
  });

  it('puts task progress and team status in their own sound categories', () => {
    expect(notificationCategoryOf('deal.lost')).toBe('deal_lost');
    for (const t of ['task.updated', 'task.commented', 'task.completed']) expect(notificationCategoryOf(t)).toBe('task_updates');
    expect(notificationCategoryOf('team.status')).toBe('team_status');
    // No type is in two categories.
    const types = NOTIFICATION_CATEGORIES.flatMap((c) => c.types);
    expect(new Set(types).size).toBe(types.length);
  });
});
