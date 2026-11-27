import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PipCard, PipDetail, PipsView, RecognitionCard, RecognitionScopeView, RecognitionTargetRow, RecognitionView } from '@dealflow/types';
import { DEFAULT_RECOGNITION_POLICY } from '@dealflow/types';
import { api, ownerClient, registerUser, type TestUser, workspacePerson } from './helpers';

/*
 * Employee of the Month and Performance Improvement Plans (ADR 0102) through the API with real records. A manager
 * sets an Employee of the Month target for an executive; the executive's own companies and contacts make them
 * eligible; the manager names the team's winner and the Super Workspace's automatic selection names the
 * organisation's. A manager gives an executive an improvement plan, the Super Workspace gives one to the manager;
 * goals are counted from records or evaluated, the plan moves to Ready for review by itself, and only a person with
 * the right closes it. Every refusal is checked on the server.
 */

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
type Person = TestUser & { userId: string; workspaceId: string };
type Note = { type: string; title: string; actionRequired?: boolean };

async function notes(u: TestUser): Promise<Note[]> {
  return (await api(u).get('/notifications?limit=100').expect(200)).body.items as Note[];
}

async function company(u: TestUser, name = `Acme ${stamp()}`) {
  await api(u).post('/companies', { name, website: `https://${name.toLowerCase().replace(/\s+/g, '-')}.test` }).expect(201);
}

function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

describe('Employee of the Month and improvement plans', () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let manager: Person;
  let priya: Person;
  let arjun: Person;
  let other: TestUser;
  let month: string;
  let today: string;
  const db = ownerClient();

  beforeAll(async () => {
    const { startApp } = await import('./helpers');
    app = await startApp();
    superAdmin = await registerUser(app, 'Frequent Research Recognition');
    manager = await workspacePerson(app, superAdmin, 'MANAGER', 'Rahul Sharma');
    await api(superAdmin).put(`/workspaces/${manager.workspaceId}/permissions`, { canCreateExecutives: true }).expect(200);
    priya = await workspacePerson(app, manager, 'EXECUTIVE', 'Priya Sharma');
    arjun = await workspacePerson(app, manager, 'EXECUTIVE', 'Arjun Mehta');
    other = await registerUser(app, 'Another Client');
    const card = (await api(priya).get('/recognition/me').expect(200)).body as RecognitionCard;
    month = card.month;
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: superAdmin.tenantId }, select: { defaultTimezone: true } });
    today = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.defaultTimezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('shows the card with no target, and only people above may set one', async () => {
    const empty = (await api(priya).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(empty).toMatchObject({ target: null, winners: [], mine: null });

    const goals = [{ measure: 'QUALIFIED_COMPANIES', amount: 2 }, { measure: 'CONTACTS', amount: 1 }];
    // An executive cannot set targets, not even for a teammate.
    await api(priya).post('/recognition/targets', { name: 'November push', month, userId: arjun.userId, goals }).expect(403);
    // A manager cannot set one for itself, and the manual evaluation measure is refused for Employee of the Month.
    await api(manager).post('/recognition/targets', { name: 'Me', month, userId: manager.userId, goals }).expect(403);
    await api(manager).post('/recognition/targets', { name: 'Manual', month, userId: priya.userId, goals: [{ measure: 'MANUAL', amount: 80 }] }).expect(400);
    // Another organisation's people are out of reach.
    await api(other).post('/recognition/targets', { name: 'Steal', month, userId: priya.userId, goals }).expect(403);
  });

  it('counts real records, tells the person at milestones, and makes them eligible', async () => {
    const created = (await api(manager)
      .post('/recognition/targets', { name: 'Employee of the Month push', month, userId: priya.userId, goals: [{ measure: 'QUALIFIED_COMPANIES', amount: 2 }, { measure: 'CONTACTS', amount: 1 }], reward: 'Team dinner' })
      .expect(201)).body as RecognitionTargetRow;
    expect(created).toMatchObject({ status: 'ACTIVE', eligible: false, achievementPercent: 0, setByLevel: 'MANAGER', editable: true, person: { id: priya.userId, level: 'EXECUTIVE', managers: [{ id: manager.userId }] } });
    // One target per person and month.
    await api(manager).post('/recognition/targets', { name: 'Again', month, userId: priya.userId, goals: [{ measure: 'CONTACTS', amount: 1 }] }).expect(409);
    expect((await notes(priya)).some((n) => n.type === 'recognition.target_set' && n.title === 'New Employee of the Month target: Employee of the Month push')).toBe(true);

    await company(priya);
    await company(priya);
    let card = (await api(priya).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(card.target!.goals[0]).toMatchObject({ measure: 'QUALIFIED_COMPANIES', done: 2, required: 2, met: true, percent: 100 });
    expect(card.target!.goals[1]).toMatchObject({ measure: 'CONTACTS', done: 0, met: false });
    expect(card.target).toMatchObject({ achievementPercent: 50, eligible: false, status: 'ACTIVE' });
    expect((await notes(priya)).filter((n) => n.type === 'recognition.milestone')).toHaveLength(1);

    await api(priya).post('/contacts', { firstName: 'Gia', lastName: 'Buyer', email: `gia.${stamp()}@globex.test` }).expect(201);
    card = (await api(priya).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(card.target).toMatchObject({ achievementPercent: 100, eligible: true, status: 'ELIGIBLE' });
    expect(card.target!.performance.score).toBeGreaterThan(0);
    // Read again: the notices are never sent twice.
    await api(priya).get('/recognition/me').expect(200);
    expect((await notes(priya)).filter((n) => n.type === 'recognition.eligible' && n.title === 'Congratulations! You have achieved your Employee of the Month target.')).toHaveLength(1);
    expect((await notes(manager)).filter((n) => n.type === 'recognition.eligible' && n.title === 'Priya Sharma is eligible for Employee of the Month')).toHaveLength(1);
    const achievements = (await api(priya).get('/achievements').expect(200)).body.items as { kind: string }[];
    expect(achievements.some((a) => a.kind === 'RECOGNITION_ELIGIBLE')).toBe(true);
  });

  it('keeps the history of a change, recalculates and tells the person', async () => {
    const t = (await api(manager).post('/recognition/targets', { name: 'Arjun’s month', month, userId: arjun.userId, goals: [{ measure: 'QUALIFIED_COMPANIES', amount: 1 }] }).expect(201)).body as RecognitionTargetRow;
    await company(arjun);
    let card = (await api(arjun).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(card.target).toMatchObject({ eligible: true });
    const updated = (await api(manager).patch(`/recognition/targets/${t.id}`, { goals: [{ id: t.goals[0]!.id, measure: 'QUALIFIED_COMPANIES', amount: 3 }] }).expect(200)).body as RecognitionTargetRow;
    expect(updated).toMatchObject({ eligible: false, status: 'ACTIVE' });
    expect(updated.revisions[0]!.changes[0]).toContain('Goals:');
    card = (await api(arjun).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(card.target!.goals[0]).toMatchObject({ done: 1, required: 3, remaining: 2 });
    expect((await notes(arjun)).some((n) => n.type === 'recognition.target_updated')).toBe(true);
    // An executive cannot change their own target.
    await api(arjun).patch(`/recognition/targets/${t.id}`, { name: 'Easier' }).expect(403);
  });

  it('lets the manager name the team winner from eligible people only, once per month', async () => {
    await api(manager).post('/recognition/awards', { month, userId: arjun.userId }).expect(409);
    const view = (await api(manager).get('/recognition').expect(200)).body as RecognitionView;
    const team = view.scopes.find((s) => s.scope === 'TEAM')!;
    expect(team.canSelect).toBe(true);
    expect(team.candidates.map((c) => c.target.person.name)).toEqual(['Priya Sharma']);

    const award = (await api(manager).post('/recognition/awards', { month, userId: priya.userId, note: 'Best month of the team' }).expect(201)).body;
    expect(award).toMatchObject({ scope: 'TEAM', method: 'MANUAL', person: { id: priya.userId }, selectedBy: { id: manager.userId }, reward: 'Team dinner' });
    await api(manager).post('/recognition/awards', { month, userId: priya.userId }).expect(409);

    const card = (await api(priya).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(card.mine).toMatchObject({ id: award.id, scope: 'TEAM' });
    expect(card.target!.status).toBe('AWARDED');
    // Arjun's card shows his team's winner, and his own progress.
    const arjunCard = (await api(arjun).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(arjunCard.winners.map((w) => w.person.name)).toEqual(['Priya Sharma']);
    expect(arjunCard.mine).toBeNull();
    expect(arjunCard.target!.status).toBe('ACTIVE');
    expect((await notes(priya)).filter((n) => n.type === 'recognition.awarded')).toHaveLength(1);
    const achievements = (await api(priya).get('/achievements').expect(200)).body.items as { kind: string; level: string }[];
    expect(achievements.find((a) => a.kind === 'EMPLOYEE_OF_THE_MONTH')).toMatchObject({ level: 'EXCEPTIONAL' });

    // The certificate: the winner and the people above can print it; a teammate cannot.
    const pdf = await priya.agent.get(`/api/v1/recognition/awards/${award.id}/certificate`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await api(arjun).get(`/recognition/awards/${award.id}/certificate`).expect(404);
    await api(superAdmin).get(`/recognition/awards/${award.id}/certificate`).expect(200);
  });

  it('follows the Super Workspace’s policy: automatic selection, ranking and what managers may do', async () => {
    await api(manager).put('/recognition/policy', { ...DEFAULT_RECOGNITION_POLICY, selection: 'AUTOMATIC' }).expect(403);
    await api(superAdmin).put('/recognition/policy', { ...DEFAULT_RECOGNITION_POLICY, selection: 'AUTOMATIC', ranking: ['ACHIEVEMENT', 'SCORE'], managersSelectTeamWinner: false }).expect(200);
    const result = (await api(superAdmin).post('/recognition/select', { month }).expect(200)).body as RecognitionScopeView;
    expect(result.award).toMatchObject({ scope: 'ORGANISATION', method: 'AUTOMATIC', person: { id: priya.userId }, selectedBy: { id: expect.any(String) } });
    // Running it again changes nothing.
    const again = (await api(superAdmin).post('/recognition/select', { month }).expect(200)).body as RecognitionScopeView;
    expect(again.award!.id).toBe(result.award!.id);
    await api(manager).post('/recognition/select', { month }).expect(403);

    const card = (await api(arjun).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(card.winners.map((w) => w.scope).sort()).toEqual(['ORGANISATION', 'TEAM']);
    // Managers may no longer name the team winner: withdrawing the team award and choosing again is refused.
    const view = (await api(manager).get('/recognition').expect(200)).body as RecognitionView;
    const teamAward = view.scopes.find((s) => s.scope === 'TEAM')!.award!;
    expect(teamAward.canRevoke).toBe(false);
    await api(superAdmin).post(`/recognition/awards/${teamAward.id}/revoke`, { reason: 'Policy changed' }).expect(204);
    await api(manager).post('/recognition/awards', { month, userId: priya.userId }).expect(403);
    // The organisation's history keeps the withdrawn award with its reason.
    const stored = await db.recognitionAward.findFirstOrThrow({ where: { id: teamAward.id } });
    expect(stored).toMatchObject({ revokeReason: 'Policy changed' });
    expect(stored.revokedAt).not.toBeNull();
    await api(superAdmin).put('/recognition/policy', DEFAULT_RECOGNITION_POLICY).expect(200);
  });

  it('lets the Super Workspace set a target for a manager, and keeps other organisations out', async () => {
    const t = (await api(superAdmin).post('/recognition/targets', { name: 'Team leadership', month, userId: manager.userId, goals: [{ measure: 'TASK_COMPLETION', amount: 90 }] }).expect(201)).body as RecognitionTargetRow;
    expect(t).toMatchObject({ setByLevel: 'SUPER', person: { level: 'MANAGER' } });
    // No task fell due, so the measure says so instead of showing 0% as a result.
    expect(t.goals[0]).toMatchObject({ measurable: false, done: null });
    const card = (await api(manager).get('/recognition/me').expect(200)).body as RecognitionCard;
    expect(card.target!.id).toBe(t.id);
    await api(other).patch(`/recognition/targets/${t.id}`, { name: 'x' }).expect(404);
    await api(superAdmin).post(`/recognition/targets/${t.id}/cancel`).expect(204);
    expect(((await api(manager).get('/recognition/me').expect(200)).body as RecognitionCard).target).toBeNull();
  });

  // ───────────── Improvement plans ─────────────

  let arjunPlan: PipDetail;
  let rahulPlan: PipDetail;

  it('assigns plans down the hierarchy only, and shows the card only while a plan is open', async () => {
    const body = (userId: string, title: string) => ({
      title, userId, reason: 'Fewer qualified companies than the team for two months.', areas: ['Prospecting', 'Call quality'],
      currentLevel: '5 qualified companies a week', requiredLevel: '1 qualified company and a good call review',
      goals: [{ measure: 'QUALIFIED_COMPANIES', amount: 2 }, { measure: 'MANUAL', amount: 70, label: 'Call quality review' }],
      startsOn: today, endsOn: addDays(today, 30), reviewFrequency: 'WEEKLY',
    });
    await api(arjun).post('/pips', body(priya.userId, 'Nope')).expect(403);
    await api(manager).post('/pips', body(manager.userId, 'Self')).expect(403);
    expect(((await api(arjun).get('/pips/me').expect(200)).body as PipCard).plan).toBeNull();

    arjunPlan = (await api(manager).post('/pips', body(arjun.userId, '30-day prospecting plan')).expect(201)).body as PipDetail;
    expect(arjunPlan).toMatchObject({ number: expect.stringMatching(/^PIP-\d{4}$/), status: 'ACTIVE', assignedBy: { id: manager.userId, level: 'MANAGER' }, can: { decide: true, edit: true } });
    expect(arjunPlan.reviewDates.at(-1)).toBe(addDays(today, 30));
    expect(arjunPlan.reviewDates[0]).toBe(addDays(today, 7));
    await api(manager).post('/pips', body(arjun.userId, 'Second')).expect(409);

    const card = (await api(arjun).get('/pips/me').expect(200)).body as PipCard;
    expect(card.plan).toMatchObject({ id: arjunPlan.id, status: 'ACTIVE', daysRemaining: 31, can: { acknowledge: true, decide: false, edit: false } });
    expect(((await api(priya).get('/pips/me').expect(200)).body as PipCard).plan).toBeNull();
    await api(priya).get(`/pips/${arjunPlan.id}`).expect(404);
    await api(other).get(`/pips/${arjunPlan.id}`).expect(404);
    await api(arjun).get('/pips/me').expect(200);
    expect((await notes(arjun)).filter((n) => n.type === 'pip.assigned' && n.actionRequired)).toHaveLength(1);

    // The Super Workspace gives the manager a plan; the manager cannot decide its own plan.
    rahulPlan = (await api(superAdmin).post('/pips', { ...body(manager.userId, 'Team coaching plan'), goals: [{ measure: 'MANUAL', amount: 60, label: 'Coaching review' }] }).expect(201)).body as PipDetail;
    expect(((await api(manager).get('/pips/me').expect(200)).body as PipCard).plan!.id).toBe(rahulPlan.id);
    await api(manager).post(`/pips/${rahulPlan.id}/decision`, { decision: 'CANCEL', comment: 'Mine' }).expect(403);
    const list = (await api(manager).get('/pips').expect(200)).body as PipsView;
    expect(list.mine.map((p) => p.id)).toEqual([rahulPlan.id]);
    expect(list.open.map((p) => p.id)).toEqual([arjunPlan.id]);
  });

  it('counts goals, takes evaluations, moves to Ready for review, and closes only on a decision', async () => {
    const ack = (await api(arjun).post(`/pips/${arjunPlan.id}/acknowledge`, { comment: 'Understood, I will work on it.' }).expect(200)).body as PipDetail;
    expect(ack).toMatchObject({ status: 'IN_PROGRESS', employeeComment: 'Understood, I will work on it.' });
    expect((await notes(manager)).some((n) => n.type === 'pip.acknowledged')).toBe(true);

    // Arjun's earlier company counts only from the plan's start (today), so two new ones are needed... one was today.
    let plan = (await api(arjun).get(`/pips/${arjunPlan.id}`).expect(200)).body as PipDetail;
    const before = plan.goals[0]!.done!;
    for (let i = before; i < 2; i++) await company(arjun);
    plan = (await api(arjun).get(`/pips/${arjunPlan.id}`).expect(200)).body as PipDetail;
    expect(plan.goals[0]).toMatchObject({ met: true });
    expect(plan.goals[1]).toMatchObject({ measure: 'MANUAL', measurable: false, met: false });
    expect(plan).toMatchObject({ percent: 50, goalsMet: 1, status: 'IN_PROGRESS' });
    expect(plan.events.some((e) => e.kind === 'GOAL_MET')).toBe(true);
    expect((await notes(arjun)).some((n) => n.type === 'pip.target_completed')).toBe(true);

    // Not ready: completing is refused, and an executive cannot evaluate or decide.
    await api(manager).post(`/pips/${arjunPlan.id}/decision`, { decision: 'COMPLETE', comment: 'Good' }).expect(409);
    await api(arjun).post(`/pips/${arjunPlan.id}/evaluations`, { goalId: plan.goals[1]!.id, score: 100, comments: 'Me' }).expect(403);
    await api(arjun).post(`/pips/${arjunPlan.id}/decision`, { decision: 'COMPLETE', comment: 'Me' }).expect(403);

    plan = (await api(manager).post(`/pips/${arjunPlan.id}/evaluations`, { goalId: plan.goals[1]!.id, score: 80, comments: 'Calls are clear and well prepared.' }).expect(200)).body as PipDetail;
    expect(plan.goals[1]).toMatchObject({ done: 80, met: true, evaluations: [{ score: 80, evaluator: { id: manager.userId, name: 'Rahul Sharma' } }] });
    expect(plan).toMatchObject({ status: 'READY_FOR_REVIEW', percent: 100, goalsMet: 2 });
    expect((await notes(manager)).filter((n) => n.type === 'pip.ready_for_review' && n.actionRequired)).toHaveLength(1);

    // Comments both ways, kept in the history.
    await api(arjun).post(`/pips/${arjunPlan.id}/comments`, { body: 'Attached my call notes.', documents: [{ name: 'Call notes', url: 'https://example.com/notes' }] }).expect(200);
    plan = (await api(manager).post(`/pips/${arjunPlan.id}/reviews`, { notes: 'Strong improvement this week.' }).expect(200)).body as PipDetail;
    expect(plan.status).toBe('READY_FOR_REVIEW');
    expect(plan.managerFeedback).toBe('Strong improvement this week.');

    plan = (await api(manager).post(`/pips/${arjunPlan.id}/decision`, { decision: 'COMPLETE', comment: 'Every goal met. Well done.' }).expect(200)).body as PipDetail;
    expect(plan).toMatchObject({ status: 'COMPLETED', closingComment: 'Every goal met. Well done.' });
    expect(plan.completedAt).not.toBeNull();
    await api(manager).patch(`/pips/${arjunPlan.id}`, { title: 'Later' }).expect(409);

    // The open card is gone; a one-time success message shows until Arjun closes it.
    let card = (await api(arjun).get('/pips/me').expect(200)).body as PipCard;
    expect(card.plan).toBeNull();
    expect(card.completed).toMatchObject({ id: arjunPlan.id, status: 'COMPLETED' });
    await api(arjun).post(`/pips/${arjunPlan.id}/dismiss`).expect(204);
    card = (await api(arjun).get('/pips/me').expect(200)).body as PipCard;
    expect(card).toEqual({ plan: null, completed: null });
    expect((await notes(arjun)).some((n) => n.type === 'pip.completed')).toBe(true);
    const achievements = (await api(arjun).get('/achievements').expect(200)).body.items as { kind: string }[];
    expect(achievements.some((a) => a.kind === 'PIP_COMPLETED')).toBe(true);

    // History stays: the plan is in the closed list with every step.
    const list = (await api(manager).get('/pips').expect(200)).body as PipsView;
    expect(list.closed.map((p) => p.id)).toContain(arjunPlan.id);
    const kinds = ((await api(manager).get(`/pips/${arjunPlan.id}`).expect(200)).body as PipDetail).events.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['CREATED', 'ACKNOWLEDGED', 'GOAL_MET', 'EVALUATION', 'READY_FOR_REVIEW', 'COMMENT', 'REVIEW', 'COMPLETED']));
  });

  it('reminds reviewers, extends, updates goals and never fails a plan without a decision', async () => {
    await api(superAdmin).put('/recognition/policy', { ...DEFAULT_RECOGNITION_POLICY, reviewReminderDays: 14 }).expect(200);
    await api(superAdmin).get(`/pips/${rahulPlan.id}`).expect(200);
    expect((await notes(superAdmin)).filter((n) => n.type === 'pip.review_due' && n.actionRequired)).toHaveLength(1);
    await api(superAdmin).get(`/pips/${rahulPlan.id}`).expect(200);
    expect((await notes(superAdmin)).filter((n) => n.type === 'pip.review_due')).toHaveLength(1);

    let plan = (await api(superAdmin).patch(`/pips/${rahulPlan.id}`, { goals: [{ id: rahulPlan.goals[0]!.id, measure: 'MANUAL', amount: 75, label: 'Coaching review' }], comment: 'Raised after the first review.' }).expect(200)).body as PipDetail;
    expect(plan.events[0]).toMatchObject({ kind: 'UPDATED', body: 'Raised after the first review.' });
    expect((await notes(manager)).some((n) => n.type === 'pip.updated')).toBe(true);

    plan = (await api(superAdmin).post(`/pips/${rahulPlan.id}/decision`, { decision: 'EXTEND', comment: 'Two more weeks.', endsOn: addDays(today, 44) }).expect(200)).body as PipDetail;
    expect(plan).toMatchObject({ status: 'EXTENDED', endsOn: addDays(today, 44), originalEndsOn: addDays(today, 30) });
    await api(superAdmin).post(`/pips/${rahulPlan.id}/decision`, { decision: 'EXTEND', comment: 'Earlier', endsOn: addDays(today, 10) }).expect(400);
    expect((await notes(manager)).some((n) => n.type === 'pip.extended')).toBe(true);
    // Still open after the sweep: a deadline alone never closes a plan.
    await app.get((await import('../src/recognition/pips.service')).PipsService).sweep(true);
    expect(((await api(manager).get('/pips/me').expect(200)).body as PipCard).plan!.status).toBe('EXTENDED');

    plan = (await api(superAdmin).post(`/pips/${rahulPlan.id}/decision`, { decision: 'UNSUCCESSFUL', comment: 'The coaching goal was not reached.' }).expect(200)).body as PipDetail;
    expect(plan.status).toBe('UNSUCCESSFUL');
    expect(((await api(manager).get('/pips/me').expect(200)).body as PipCard)).toEqual({ plan: null, completed: null });
  });

  it('lets the Super Workspace stop managers from giving plans', async () => {
    await api(superAdmin).put('/recognition/policy', { ...DEFAULT_RECOGNITION_POLICY, managersAssignPlans: false }).expect(200);
    const res = await api(manager).post('/pips', { title: 'Plan', userId: priya.userId, reason: 'r', areas: ['a'], goals: [{ measure: 'CONTACTS', amount: 1 }], startsOn: today, endsOn: addDays(today, 10) }).expect(403);
    expect(res.body.error.code).toBe('MANAGERS_NOT_ALLOWED');
    expect(((await api(manager).get('/pips').expect(200)).body as PipsView).canAssign).toBe(false);
    // The Super Workspace can still give one, as a draft first: Priya sees nothing until it starts.
    const draft = (await api(superAdmin).post('/pips', { title: 'Plan', userId: priya.userId, reason: 'r', areas: ['a'], goals: [{ measure: 'CONTACTS', amount: 1 }], startsOn: today, endsOn: addDays(today, 10), activate: false }).expect(201)).body as PipDetail;
    expect(draft.status).toBe('DRAFT');
    expect(((await api(priya).get('/pips/me').expect(200)).body as PipCard).plan).toBeNull();
    await api(priya).get(`/pips/${draft.id}`).expect(404);
    const started = (await api(superAdmin).post(`/pips/${draft.id}/activate`).expect(200)).body as PipDetail;
    expect(started.status).not.toBe('DRAFT');
    expect(((await api(priya).get('/pips/me').expect(200)).body as PipCard).plan!.id).toBe(draft.id);
    await api(superAdmin).post(`/pips/${draft.id}/decision`, { decision: 'CANCEL', comment: 'Set by mistake.' }).expect(200);
    await api(superAdmin).put('/recognition/policy', DEFAULT_RECOGNITION_POLICY).expect(200);
  });
});
