import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APPROVAL_HEADER } from '@dealflow/types';
import { TeamApprovalsService } from '../src/team-approvals/team-approvals.service';
import { WorkerService } from '../src/worker/worker.service';
import { api, asTenant, perWorkspaceDelete, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/*
 * Delete approvals, the Approval section and Deleted items (ADR 0098): Super and Manager Workspaces delete directly,
 * an Executive Workspace asks its manager; the approval is tied to the exact record and action, runs once, lapses,
 * moves up when nobody decides, and every delete can be restored.
 */
async function company(u: TestUser, name: string): Promise<string> {
  return (await api(u).post('/companies', { name }).expect(201)).body.id as string;
}

describe('team approvals and deleted items', () => {
  let app: INestApplication;
  let owner: TestUser & { userId?: string };
  let manager: TestUser & { userId: string; workspaceId: string };
  let executive: TestUser & { userId: string; workspaceId: string };
  let otherExecutive: TestUser & { userId: string; workspaceId: string };
  let outsider: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Approvals Co');
    manager = await workspacePerson(app, owner, 'MANAGER', 'Meera Manager');
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { canCreateExecutives: true }).expect(200);
    executive = await workspacePerson(app, manager, 'EXECUTIVE', 'Esha Executive');
    // An executive of the Super Workspace directly, whose requests go to the Super Workspace.
    otherExecutive = await workspacePerson(app, owner, 'EXECUTIVE', 'Omar Executive');
    outsider = await registerUser(app, 'Someone Else Ltd');
    // Managers and executives get Delete by default (the Super Workspace can switch it off in Rules).
    const settings = (await api(owner).get('/team-approvals/overview').expect(200)).body.settings;
    expect(settings.lowerLevelsDelete).toBe(true);
    // Switching it off takes Delete away again (W2: per-workspace grants); switching it on gives it back.
    await api(owner).put('/team-approvals/settings', { ...settings, lowerLevelsDelete: false }).expect(200);
    const b = await company(manager, 'Before The Switch Ltd');
    expect((await api(manager).del(`/companies/${b}`).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    await api(owner).put('/team-approvals/settings', { ...settings, lowerLevelsDelete: true }).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  const ask = (u: TestUser, path: string, reason = 'Duplicate of another record', method = 'DELETE', body?: unknown) =>
    api(u).post('/team-approvals', { category: 'delete', reason, action: { method, path, ...(body === undefined ? {} : { body }) } });

  it('lets the Super and Manager Workspaces delete directly, and keeps each delete in Deleted items', async () => {
    const a = await company(owner, 'Super Delete Ltd');
    await api(owner).del(`/companies/${a}`).expect(204);
    const b = await company(manager, 'Manager Delete Ltd');
    await api(manager).del(`/companies/${b}`).expect(204);

    const bin = (await api(owner).get('/deleted-items').expect(200)).body as { label: string; recordType: string; canRestore: boolean }[];
    expect(bin.map((x) => x.label)).toEqual(expect.arrayContaining(['Super Delete Ltd', 'Manager Delete Ltd']));
    // The manager sees its own team's deletes only.
    const mine = (await api(manager).get('/deleted-items').expect(200)).body as { label: string }[];
    expect(mine.map((x) => x.label)).toContain('Manager Delete Ltd');
    expect(mine.map((x) => x.label)).not.toContain('Super Delete Ltd');
  });

  it('asks an executive for approval, ties it to the exact record, and lets them delete once approved', async () => {
    const id = await company(executive, 'Esha Duplicate Pvt');
    const refused = await api(executive).del(`/companies/${id}`).expect(403);
    expect(refused.body.error.code).toBe('APPROVAL_REQUIRED');
    const details = Object.fromEntries((refused.body.error.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
    expect(details).toMatchObject({ category: 'delete', recordTypeLabel: 'Company', recordName: 'Esha Duplicate Pvt' });
    // Nothing was deleted, and no password was asked first.
    expect((await api(executive).get(`/companies/${id}`).expect(200)).body.name).toBe('Esha Duplicate Pvt');

    const req = (await ask(executive, `/companies/${id}`).expect(201)).body;
    expect(req).toMatchObject({ status: 'PENDING', category: 'delete', recordType: 'company', recordName: 'Esha Duplicate Pvt', recordId: id, recordTypeLabel: 'Company', reason: 'Duplicate of another record' });
    expect(req.requester.name).toBe('Esha Executive');
    expect(req.requesterWorkspace.level).toBe('EXECUTIVE');
    expect(req.approverWorkspace).toMatchObject({ id: manager.workspaceId, level: 'MANAGER' });
    expect(req.assignedManagers.map((m: { name: string }) => m.name)).toEqual(['Meera Manager']);
    expect(req.reference).toMatch(/^APR-\d+$/);
    // Asking again hands back the same request.
    expect((await ask(executive, `/companies/${id}`).expect(201)).body.id).toBe(req.id);
    // The refusal now names the waiting request.
    const again = await api(executive).del(`/companies/${id}`).expect(403);
    expect((again.body.error.details as { path: string; message: string }[]).find((d) => d.path === 'pendingId')?.message).toBe(req.id);

    // The manager is told, sees it to decide; the executive cannot decide their own; the other executive cannot see it.
    const notes = (await api(manager).get('/notifications').expect(200)).body;
    expect(JSON.stringify(notes)).toContain('asks for approval');
    expect((await api(manager).get('/team-approvals/overview').expect(200)).body.counts.toDecide).toBeGreaterThanOrEqual(1);
    const inbox = (await api(manager).get('/team-approvals?box=decide&status=PENDING').expect(200)).body as { id: string; canDecide: boolean }[];
    expect(inbox.find((r) => r.id === req.id)?.canDecide).toBe(true);
    expect((await api(executive).post(`/team-approvals/${req.id}/decision`, { decision: 'approve' }).expect(403)).body.error.code).toBe('NO_SELF_APPROVAL');
    await api(otherExecutive).get(`/team-approvals/${req.id}`).expect(404);
    await api(outsider).get(`/team-approvals/${req.id}`).expect(404);

    const approved = (await api(manager).post(`/team-approvals/${req.id}/decision`, { decision: 'approve', note: 'Fine, it is a duplicate' }).expect(200)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', decisionNote: 'Fine, it is a duplicate' });
    expect(approved.decidedBy.name).toBe('Meera Manager');
    // Deciding twice is refused.
    await api(manager).post(`/team-approvals/${req.id}/decision`, { decision: 'reject' }).expect(409);

    const ready = (await api(executive).get(`/team-approvals/${req.id}`).expect(200)).body;
    expect(ready).toMatchObject({ canCarryOut: true, recordChanged: false, action: { method: 'DELETE', path: `/companies/${id}` } });
    // The approval is for this record only.
    const other = await company(executive, 'Something Else Pvt');
    expect((await api(executive).del(`/companies/${other}`).set(APPROVAL_HEADER, req.id).expect(403)).body.error.code).toBe('APPROVAL_NOT_VALID');
    // Without the password nothing happens and the approval is not used up.
    expect((await api(executive).delUnconfirmed(`/companies/${id}`).set(APPROVAL_HEADER, req.id).expect(403)).body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    await api(executive).del(`/companies/${id}`).set(APPROVAL_HEADER, req.id).expect(204);
    await api(executive).get(`/companies/${id}`).expect(404);

    const done = (await api(executive).get(`/team-approvals/${req.id}`).expect(200)).body;
    expect(done.status).toBe('COMPLETED');
    expect(done.deletedItemsId).toBeTruthy();
    // It runs once.
    expect((await api(executive).del(`/companies/${other}`).set(APPROVAL_HEADER, req.id).expect(403)).body.error.code).toBe('APPROVAL_NOT_VALID');

    // The delete is in Deleted items with the approval's reference, and can be restored.
    const bin = (await api(manager).get('/deleted-items').expect(200)).body as { id: string; label: string; approvalReference: string | null }[];
    const kept = bin.find((b) => b.id === done.deletedItemsId)!;
    expect(kept).toMatchObject({ label: 'Esha Duplicate Pvt', approvalReference: req.reference });
    expect((await api(executive).post(`/deleted-items/${kept.id}/restore`).expect(200)).body).toMatchObject({ restored: 1, failed: 0 });
    expect((await api(executive).get(`/companies/${id}`).expect(200)).body.name).toBe('Esha Duplicate Pvt');
    await api(executive).post(`/deleted-items/${kept.id}/restore`).expect(409);
  });

  it('refuses an approved delete when the record changed after approval', async () => {
    const id = await company(executive, 'Changing Record Pvt');
    const req = (await ask(executive, `/companies/${id}`).expect(201)).body;
    await api(manager).post(`/team-approvals/${req.id}/decision`, { decision: 'approve' }).expect(200);
    await api(executive).patch(`/companies/${id}`, { website: 'https://changed.example.com' }).expect(200);
    const view = (await api(executive).get(`/team-approvals/${req.id}`).expect(200)).body;
    expect(view).toMatchObject({ recordChanged: true, canCarryOut: false });
    const res = await api(executive).del(`/companies/${id}`).set(APPROVAL_HEADER, req.id).expect(403);
    expect(res.body.error).toMatchObject({ code: 'APPROVAL_NOT_VALID', message: expect.stringContaining('changed after it was approved') });
    await api(executive).get(`/companies/${id}`).expect(200);
  });

  it('keeps the record when the manager rejects, and lets the requester cancel', async () => {
    const id = await company(executive, 'Rejected Delete Pvt');
    const req = (await ask(executive, `/companies/${id}`).expect(201)).body;
    const rejected = (await api(manager).post(`/team-approvals/${req.id}/decision`, { decision: 'reject', note: 'This client is active' }).expect(200)).body;
    expect(rejected.status).toBe('REJECTED');
    expect((await api(executive).del(`/companies/${id}`).set(APPROVAL_HEADER, req.id).expect(403)).body.error.code).toBe('APPROVAL_NOT_VALID');
    await api(executive).get(`/companies/${id}`).expect(200);
    const notes = (await api(executive).get('/notifications').expect(200)).body;
    expect(JSON.stringify(notes)).toContain('Not approved');

    const second = (await ask(executive, `/companies/${id}`, 'Asking once more').expect(201)).body;
    expect(second.id).not.toBe(req.id);
    expect((await api(executive).post(`/team-approvals/${second.id}/cancel`).expect(200)).body.status).toBe('CANCELLED');
    await api(manager).post(`/team-approvals/${second.id}/decision`, { decision: 'approve' }).expect(409);
  });

  it('covers bulk and delete-all requests too, with the count the person saw', async () => {
    const ids = [await company(executive, 'Bulk One Pvt'), await company(executive, 'Bulk Two Pvt')];
    const body = { entity: 'companies', action: 'delete', ids };
    const refused = await api(executive).postConfirmed('/records/bulk', body).expect(403);
    expect(refused.body.error.code).toBe('APPROVAL_REQUIRED');
    const req = (await ask(executive, '/records/bulk', 'Test companies', 'POST', body).expect(201)).body;
    expect(req).toMatchObject({ recordCount: 2, scope: 'bulk', recordTypeLabel: 'Companies' });
    await api(manager).post(`/team-approvals/${req.id}/decision`, { decision: 'approve' }).expect(200);
    expect((await api(executive).postConfirmed('/records/bulk', body).set(APPROVAL_HEADER, req.id).expect(200)).body.updated).toBe(2);
    const done = (await api(executive).get(`/team-approvals/${req.id}`).expect(200)).body;
    const bin = (await api(executive).get('/deleted-items').expect(200)).body as { id: string; label: string; count: number }[];
    expect(bin.find((b) => b.id === done.deletedItemsId)).toMatchObject({ label: '2 companies', count: 2 });

    // Delete all on a list: tied to the filters and the count.
    for (const t of ['Sweep A', 'Sweep B', 'Sweep C']) await api(executive).post('/tasks', { title: t }).expect(201);
    const count = (await api(executive).post('/tasks/count-all', { query: { scope: 'mine', status: 'OPEN', q: 'Sweep' } }).expect(200)).body.count as number;
    const all = { query: { scope: 'mine', status: 'OPEN', q: 'Sweep' }, expected: count };
    expect((await api(executive).postConfirmed('/tasks/delete-all', all).expect(403)).body.error.code).toBe('APPROVAL_REQUIRED');
    const allReq = (await ask(executive, '/tasks/delete-all', 'Old tasks', 'POST', all).expect(201)).body;
    expect(allReq).toMatchObject({ scope: 'all', recordCount: count, recordTypeLabel: 'Tasks' });
    await api(manager).post(`/team-approvals/${allReq.id}/decision`, { decision: 'approve' }).expect(200);
    // A different filter is a different action.
    expect((await api(executive).postConfirmed('/tasks/delete-all', { ...all, query: { scope: 'mine', status: 'OPEN' } }).set(APPROVAL_HEADER, allReq.id).expect(403)).body.error.code).toBe('APPROVAL_NOT_VALID');
    expect((await api(executive).postConfirmed('/tasks/delete-all', all).set(APPROVAL_HEADER, allReq.id).expect(200)).body.updated).toBe(count);
  }, 60_000);

  it('sends requests of an executive under the Super Workspace to the Super Workspace, and nobody else', async () => {
    const id = await company(otherExecutive, 'Omar Old Pvt');
    const req = (await ask(otherExecutive, `/companies/${id}`).expect(201)).body;
    expect(req.approverWorkspace.level).toBe('SUPER');
    expect(((await api(manager).get('/team-approvals?box=decide').expect(200)).body as { id: string }[]).map((r) => r.id)).not.toContain(req.id);
    await api(manager).post(`/team-approvals/${req.id}/decision`, { decision: 'approve' }).expect(404);
    await api(owner).post(`/team-approvals/${req.id}/decision`, { decision: 'approve' }).expect(200);
  });

  it('takes free-form requests about tasks and targets, and refuses what needs no approval', async () => {
    const req = (await api(executive).post('/team-approvals', { category: 'target_change', title: 'Lower my December company target to 15 a day', reason: 'Two weeks of leave' }).expect(201)).body;
    expect(req).toMatchObject({ category: 'target_change', title: 'Lower my December company target to 15 a day', action: null });
    expect((await api(manager).post(`/team-approvals/${req.id}/decision`, { decision: 'approve' }).expect(200)).body.status).toBe('APPROVED');
    // Free-form needs a title; Super has nobody to ask; a manager needs no approval to delete.
    await api(executive).post('/team-approvals', { category: 'other', reason: 'Something' }).expect(400);
    expect((await api(owner).post('/team-approvals', { category: 'other', title: 'Anything', reason: 'Nothing' }).expect(403)).body.error.code).toBe('NOBODY_ABOVE');
    const mid = await company(manager, 'Manager Own Pvt');
    expect((await ask(manager, `/companies/${mid}`).expect(400)).body.error.code).toBe('APPROVAL_NOT_NEEDED');
  });

  it('lets only the Super Workspace change the rules, and the rules apply at once', async () => {
    const overview = (await api(owner).get('/team-approvals/overview').expect(200)).body;
    expect(overview).toMatchObject({ level: 'SUPER', decides: true, canChangeSettings: true, settings: { deleteNeedsApproval: true, editNeedsApproval: false } });
    expect((await api(executive).get('/team-approvals/overview').expect(200)).body).toMatchObject({ level: 'EXECUTIVE', decides: false, needsApprovalToDelete: true });
    await api(manager).put('/team-approvals/settings', { ...overview.settings, deleteNeedsApproval: false }).expect(403);

    // Edits need approval when switched on.
    await api(owner).put('/team-approvals/settings', { ...overview.settings, editNeedsApproval: true }).expect(200);
    const id = await company(executive, 'Edit Guard Pvt');
    expect((await api(executive).patch(`/companies/${id}`, { website: 'https://x.example.com' }).expect(403)).body.error.code).toBe('APPROVAL_REQUIRED');
    await api(manager).patch(`/companies/${id}`, { website: 'https://x.example.com' }).expect(200);
    // Switched off, an executive deletes directly.
    await api(owner).put('/team-approvals/settings', { ...overview.settings, deleteNeedsApproval: false, editNeedsApproval: false }).expect(200);
    await api(executive).del(`/companies/${id}`).expect(204);
    await api(owner).put('/team-approvals/settings', overview.settings).expect(200);
  });

  it('expires undecided requests, moves slow ones up a level, and lapses unused approvals', async () => {
    const worker = app.get(WorkerService);
    const slow = (await ask(executive, `/companies/${await company(executive, 'Slow Decision Pvt')}`).expect(201)).body;
    const old = (await ask(executive, `/companies/${await company(executive, 'Old Request Pvt')}`).expect(201)).body;
    const unused = (await ask(executive, `/companies/${await company(executive, 'Unused Approval Pvt')}`).expect(201)).body;
    await api(manager).post(`/team-approvals/${unused.id}/decision`, { decision: 'approve' }).expect(200);
    await asTenant(owner.tenantId, async (tx) => {
      await tx.teamApproval.update({ where: { id: slow.id }, data: { createdAt: new Date(Date.now() - 30 * 3_600_000) } });
      await tx.teamApproval.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await tx.teamApproval.update({ where: { id: unused.id }, data: { approvedUntil: new Date(Date.now() - 1000) } });
    });
    await worker.tick();
    const s = (await api(owner).get(`/team-approvals/${slow.id}`).expect(200)).body;
    expect(s).toMatchObject({ status: 'PENDING', escalated: true, approverWorkspace: { level: 'SUPER' } });
    expect((await api(owner).get(`/team-approvals/${old.id}`).expect(200)).body.status).toBe('EXPIRED');
    expect((await api(owner).get(`/team-approvals/${unused.id}`).expect(200)).body.status).toBe('EXPIRED');
    // The Super Workspace now decides the escalated one.
    expect((await api(owner).get('/team-approvals?box=decide&status=PENDING').expect(200)).body.map((r: { id: string }) => r.id)).toContain(slow.id);
  });

  it('restores hard-deleted records with what was removed with them, and purges for good', async () => {
    const task = (await api(owner).post('/tasks', { title: 'Restore me' }).expect(201)).body.id as string;
    await api(owner).del(`/tasks/${task}`).expect(204);
    const kept = ((await api(owner).get('/deleted-items').expect(200)).body as { id: string; label: string }[]).find((b) => b.label === 'Restore me')!;
    expect(kept).toBeTruthy();
    expect((await api(owner).post(`/deleted-items/${kept.id}/restore`).expect(200)).body.restored).toBeGreaterThanOrEqual(1);
    expect(((await api(owner).get('/tasks?scope=mine').expect(200)).body as { id: string }[]).map((t) => t.id)).toContain(task);

    await api(owner).del(`/tasks/${task}`).expect(204);
    const again = ((await api(owner).get('/deleted-items').expect(200)).body as { id: string; label: string; restoredAt: string | null }[]).find((b) => b.label === 'Restore me' && !b.restoredAt)!;
    await api(owner).del(`/deleted-items/${again.id}`).expect(204);
    expect(((await api(owner).get('/deleted-items?state=any').expect(200)).body as { id: string }[]).map((b) => b.id)).not.toContain(again.id);
    // Other organisations never see these.
    expect((await api(outsider).get('/deleted-items').expect(200)).body).toEqual([]);
  });

  it('switches Delete on once for organisations that never saved the rules, and leaves saved rules alone', async () => {
    // An organisation from before this change: its manager has no Delete, and it has no saved rules.
    const older = await registerUser(app, 'Older Org');
    const lead = await workspacePerson(app, older, 'MANAGER', 'Lena Lead');
    const actions = (await api(lead).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    const without = Object.fromEntries(Object.entries(actions).map(([k, v]) => [k, v.filter((a) => a !== 'delete')]));
    await api(older).put(`/workspaces/${lead.workspaceId}/permissions`, { actions: without }).expect(200);
    const c = await company(lead, 'Old Org Duplicate');
    expect((await api(lead).del(`/companies/${c}`).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    // Saved rules with the switch off are kept as they are.
    const kept = await registerUser(app, 'Kept Rules Org');
    const keptLead = await workspacePerson(app, kept, 'MANAGER', 'Kai Kept');
    await perWorkspaceDelete(kept);

    const svc = app.get(TeamApprovalsService);
    (svc as unknown as { defaultsApplied: boolean }).defaultsApplied = false;
    expect(await svc.applyDefaults()).toBeGreaterThanOrEqual(1);
    await api(lead).del(`/companies/${c}`).expect(204);
    expect((await api(older).get('/team-approvals/overview').expect(200)).body.settings.lowerLevelsDelete).toBe(true);
    const k = await company(keptLead, 'Kept Org Record');
    expect((await api(keptLead).del(`/companies/${k}`).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    // Only once.
    expect(await svc.applyDefaults()).toBe(0);
  });
});
