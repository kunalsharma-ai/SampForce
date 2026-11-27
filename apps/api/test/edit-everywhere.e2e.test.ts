import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/**
 * Edit everywhere (ADR 0065): records that could only be created, acted on or deleted can now be edited and saved.
 * Logged activities, company interactions, manager instructions, pending lead transfer requests and company files.
 * Tasks, follow-ups and client concerns already had an update route; their edit forms are covered in the web e2e.
 */
describe('edit everywhere', () => {
  let app: INestApplication;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  let companyId: string;
  let priyaId: string;
  let raviId: string;

  const auditFor = (entityId: string, action: string) =>
    asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, entityId, action }, orderBy: { createdAt: 'asc' } }));

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Edit Everywhere Research');
    const http = api(owner);
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    manager = await inviteMember(app, owner, 'manager');
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    await http.patch(`/tenants/current/members/${mId(rep.userId)}/org`, { reportingManagerId: manager.userId }).expect(200);
    const res = (
      await http
        .post('/company-leads', {
          company: { name: 'Acme Panels', country: 'IN', ownerId: rep.userId },
          employees: [{ firstName: 'Priya', lastName: 'Nair' }, { firstName: 'Ravi', lastName: 'Kumar' }],
        })
        .expect(201)
    ).body;
    companyId = res.company.id;
    [priyaId, raviId] = res.employeeIds;
  });
  afterAll(async () => {
    await app.close();
  });

  it('edits a logged note, call, email or meeting and keeps who changed it', async () => {
    const r = api(rep);
    const lead = (await r.post('/leads', { fullName: 'Lena Ortiz', email: 'lena@example.com' }).expect(201)).body.lead;
    const a = (await r.post('/activities', { type: 'NOTE', subject: 'Intro', body: 'First draft', leadId: lead.id }).expect(201)).body;
    expect(a.editedAt).toBeNull();

    const at = '2026-11-10T09:30:00.000Z';
    const edited = (await r.patch(`/activities/${a.id}`, { type: 'CALL', subject: 'Intro call', body: 'Talked about the panel', occurredAt: at }).expect(200)).body;
    expect(edited).toMatchObject({ id: a.id, type: 'CALL', subject: 'Intro call', body: 'Talked about the panel', occurredAt: at, leadId: lead.id, owner: { id: rep.userId } });
    expect(edited.editedAt).toEqual(expect.any(String));

    // It is saved: reading it back and listing the record's activity both show the edit.
    expect((await r.get(`/activities/${a.id}`).expect(200)).body).toMatchObject({ type: 'CALL', subject: 'Intro call' });
    const list = (await r.get(`/activities?leadId=${lead.id}`).expect(200)).body.items;
    expect(list).toEqual([expect.objectContaining({ id: a.id, subject: 'Intro call', body: 'Talked about the panel' })]);
    // The timeline shows the new subject too.
    const tl = (await r.get(`/timeline/lead/${lead.id}?kinds=activity`).expect(200)).body.items;
    expect(tl[0].title).toContain('Intro call');

    // Clearing the details is allowed; an empty subject is not.
    expect((await r.patch(`/activities/${a.id}`, { body: '' }).expect(200)).body.body).toBeNull();
    const bad = await r.patch(`/activities/${a.id}`, { subject: '  ' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    // The linked record cannot be swapped through an edit.
    await r.patch(`/activities/${a.id}`, { leadId: lead.id }).expect(400);

    const audit = await auditFor(a.id, 'activity.updated');
    expect(audit).toHaveLength(2);
    expect(audit[0]!.actorUserId).toBe(rep.userId);
    expect(audit[0]!.metadata).toMatchObject({ fields: ['type', 'subject', 'body', 'occurredAt'] });

    // A deleted activity, or one in another workspace, is not found.
    const stranger = await registerUser(app, 'Elsewhere');
    await api(stranger).patch(`/activities/${a.id}`, { subject: 'Hijack' }).expect(404);
    await r.del(`/activities/${a.id}`).expect(204);
    await r.patch(`/activities/${a.id}`, { subject: 'Gone' }).expect(404);
  });

  it('refuses activity edits without the write permission', async () => {
    const lead = (await api(owner).post('/leads', { fullName: 'Read Only' }).expect(201)).body.lead;
    const a = (await api(owner).post('/activities', { type: 'NOTE', subject: 'Owner note', leadId: lead.id }).expect(201)).body;
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).patch(`/activities/${a.id}`, { subject: 'Changed' }).expect(403);
    expect((await api(owner).get(`/activities/${a.id}`).expect(200)).body.subject).toBe('Owner note');
  });

  it('edits a company interaction, including its kind and employee', async () => {
    const r = api(rep);
    const i = (await r.post('/interactions', { companyId, contactId: priyaId, kind: 'CALL_OUTGOING', subject: 'Intro call', outcome: 'No answer' }).expect(201)).body;
    const edited = (
      await r
        .patch(`/interactions/${i.id}`, { kind: 'MEETING', subject: 'Capabilities meeting', contactId: raviId, outcome: 'Wants a proposal', sentiment: 'POSITIVE', remarks: 'Bring the India deck', nextAction: 'Send proposal' })
        .expect(200)
    ).body;
    expect(edited).toMatchObject({ id: i.id, kind: 'MEETING', subject: 'Capabilities meeting', contact: { id: raviId, name: 'Ravi Kumar' }, outcome: 'Wants a proposal', sentiment: 'POSITIVE', remarks: 'Bring the India deck', nextAction: 'Send proposal' });
    expect(edited.editedAt).toEqual(expect.any(String));

    // Stored with the matching activity type, so dashboards count it as a meeting now.
    const row = await asTenant(owner.tenantId, (tx) => tx.activity.findUniqueOrThrow({ where: { id: i.id } }));
    expect(row).toMatchObject({ type: 'MEETING', interaction: 'MEETING', contactId: raviId });
    const dash = (await r.get(`/companies/${companyId}/dashboard`).expect(200)).body;
    expect(dash.kpis ?? dash).toBeTruthy();
    const list = (await r.get(`/companies/${companyId}/interactions?kind=MEETING`).expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === i.id)).toMatchObject({ subject: 'Capabilities meeting', editedAt: expect.any(String) });

    // Clearing the employee works; an employee of another company does not.
    expect((await r.patch(`/interactions/${i.id}`, { contactId: null }).expect(200)).body.contact).toBeNull();
    const elsewhere = (await api(owner).post('/company-leads', { company: { name: 'Other Co' }, employees: [{ firstName: 'Zed' }] }).expect(201)).body;
    const bad = await r.patch(`/interactions/${i.id}`, { contactId: elsewhere.employeeIds[0] }).expect(400);
    expect(bad.body.error.details[0].path).toBe('contactId');
    // Moving it to another company is not part of an edit.
    await r.patch(`/interactions/${i.id}`, { companyId: elsewhere.company.id }).expect(400);

    // A member who cannot see the company cannot edit its interactions.
    await api(other).patch(`/interactions/${i.id}`, { subject: 'Not mine' }).expect(404);

    // The generic activity edit keeps an interaction's kind consistent.
    const typeChange = await r.patch(`/activities/${i.id}`, { type: 'NOTE' }).expect(400);
    expect(typeChange.body.error.code).toBe('INTERACTION_TYPE');
    expect((await r.patch(`/activities/${i.id}`, { subject: 'Capabilities meeting (rescheduled)' }).expect(200)).body.subject).toBe('Capabilities meeting (rescheduled)');

    expect(await auditFor(i.id, 'activity.updated')).toHaveLength(3);
  });

  it('edits a task: title, details, due date, priority and assignee', async () => {
    const r = api(rep);
    const t = (await r.post('/tasks', { title: 'Send deck', dueAt: '2026-11-20T17:00:00.000Z' }).expect(201)).body;
    const edited = (await r.patch(`/tasks/${t.id}`, { title: 'Send India deck', description: 'Use the 2026 version', priority: 'HIGH', dueAt: '2026-11-21T17:00:00.000Z', assigneeId: manager.userId }).expect(200)).body;
    expect(edited).toMatchObject({ title: 'Send India deck', description: 'Use the 2026 version', priority: 'HIGH', dueAt: '2026-11-21T17:00:00.000Z', assignee: { id: manager.userId }, status: 'OPEN' });
    expect((await r.patch(`/tasks/${t.id}`, { dueAt: null }).expect(200)).body.dueAt).toBeNull();
  });

  it('lets the sender edit an open instruction and tells the recipient', async () => {
    const m = api(manager);
    const ins = (await m.post('/instructions', { toUserId: rep.userId, message: 'Call Priya today', companyId, priority: 'NORMAL' }).expect(201)).body;
    expect(ins).toMatchObject({ canEdit: true, editedAt: null });

    const due = '2026-11-18T10:00:00.000Z';
    const edited = (await m.patch(`/instructions/${ins.id}`, { message: 'Call Priya before 3 pm', priority: 'URGENT', dueAt: due, kind: 'INSTRUCTION' }).expect(200)).body;
    expect(edited).toMatchObject({ message: 'Call Priya before 3 pm', priority: 'URGENT', dueAt: due, canEdit: true });
    expect(edited.editedAt).toEqual(expect.any(String));

    // The recipient sees the new wording, cannot edit it, and was notified.
    const received = (await api(rep).get('/instructions?box=received').expect(200)).body;
    expect(received.find((x: { id: string }) => x.id === ins.id)).toMatchObject({ message: 'Call Priya before 3 pm', canEdit: false, canProgress: true });
    const bell = async () => ((await api(rep).get('/notifications').expect(200)).body.items as Array<{ title: string; body: string }>).filter((n) => n.title.startsWith('Instruction updated'));
    const notes = await bell();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toBe('Call Priya before 3 pm');
    const forbidden = await api(rep).patch(`/instructions/${ins.id}`, { message: 'Changed by me' }).expect(403);
    expect(forbidden.body.error.code).toBe('NOT_YOUR_INSTRUCTION');
    await api(other).patch(`/instructions/${ins.id}`, { message: 'x' }).expect(404);

    // Saving with nothing changed sends nothing new.
    await m.patch(`/instructions/${ins.id}`, { message: 'Call Priya before 3 pm' }).expect(200);
    expect(await bell()).toHaveLength(1);

    // Once done it can no longer be edited.
    await api(rep).post(`/instructions/${ins.id}/progress`, { action: 'DONE' }).expect(200);
    const closed = await m.patch(`/instructions/${ins.id}`, { message: 'Too late' }).expect(400);
    expect(closed.body.error.code).toBe('INSTRUCTION_CLOSED');
    expect(await auditFor(ins.id, 'instruction.updated')).toHaveLength(1);
  });

  it('lets the requester edit a pending lead transfer request', async () => {
    const r = api(rep);
    const t = (await r.post('/lead-transfers', { companyId, toUserId: other.userId, reason: 'HIGH_VALUE', opportunityValue: 10_000, currency: 'USD', remarks: 'Needs a senior' }).expect(201)).body;
    expect(t).toMatchObject({ canEdit: true, editedAt: null });
    const edited = (await r.patch(`/lead-transfers/${t.id}`, { toUserId: manager.userId, reason: 'TECHNICAL', opportunityValue: 25_000, currency: 'eur', remarks: 'Technical scoping call', contactId: priyaId }).expect(200)).body;
    expect(edited).toMatchObject({ proposed: { id: manager.userId }, reason: 'TECHNICAL', opportunityValue: 25_000, currency: 'EUR', remarks: 'Technical scoping call', contact: { id: priyaId }, status: 'PENDING', canEdit: true });
    expect(edited.editedAt).toEqual(expect.any(String));

    // The deciding manager is told it changed, and sees the new details.
    const notes = ((await api(manager).get('/notifications').expect(200)).body.items as Array<{ title: string }>).filter((n) => n.title.startsWith('Company transfer request updated'));
    expect(notes).toHaveLength(1);
    const toDecide = (await api(manager).get('/lead-transfers?box=toDecide').expect(200)).body;
    expect(toDecide.find((x: { id: string }) => x.id === t.id)).toMatchObject({ reason: 'TECHNICAL', canEdit: false, canDecide: true });

    // Only the requester, and only while pending.
    await api(manager).patch(`/lead-transfers/${t.id}`, { remarks: 'x' }).expect(404);
    const owns = await r.patch(`/lead-transfers/${t.id}`, { toUserId: rep.userId }).expect(400);
    expect(owns.body.error.details[0].path).toBe('toUserId');
    await r.patch(`/lead-transfers/${t.id}`, { companyId }).expect(400);
    await api(manager).post(`/lead-transfers/${t.id}/decision`, { action: 'REJECT', note: 'Keep it for now' }).expect(200);
    const decided = await r.patch(`/lead-transfers/${t.id}`, { remarks: 'Please reconsider' }).expect(400);
    expect(decided.body.error.code).toBe('TRANSFER_DECIDED');
  });

  it('renames a company file', async () => {
    const up = (
      await owner.agent.post(`/api/v1/companies/${companyId}/files?name=brief.pdf`).set('origin', ORIGIN).set('content-type', 'application/pdf').send(Buffer.from('%PDF-1.4 brief')).expect(201)
    ).body;
    const renamed = (await api(rep).patch(`/company-files/${up.id}`, { name: 'Acme brief 2026.pdf' }).expect(200)).body;
    expect(renamed).toMatchObject({ id: up.id, name: 'Acme brief 2026.pdf', sizeBytes: up.sizeBytes });
    const files = (await api(rep).get(`/companies/${companyId}/files`).expect(200)).body;
    expect(files.find((f: { id: string }) => f.id === up.id).name).toBe('Acme brief 2026.pdf');
    const dl = await owner.agent.get(`/api/v1/company-files/${up.id}/download`).expect(200);
    expect(dl.headers['content-disposition']).toContain('Acme');
    await api(rep).patch(`/company-files/${up.id}`, { name: '' }).expect(400);
    await api(other).patch(`/company-files/${up.id}`, { name: 'mine.pdf' }).expect(404);
    const audit = await auditFor(companyId, 'company.file_renamed');
    expect(audit[0]!.metadata).toMatchObject({ from: 'brief.pdf', to: 'Acme brief 2026.pdf' });
  });
});
