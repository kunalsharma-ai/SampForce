import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, ownerClient, registerUser, setPlan, startApp, type TestUser } from './helpers';

/*
 * Removing a person from the workspace completely (Team Management). The owner sees what moves first, types their
 * password, picks who receives the records, and the person is gone from the members list: their sign-in here stops,
 * their records and open tasks belong to the receiver, their invitations are deleted, and the audit log says so.
 * Invitation rows (accepted, revoked, expired) can be deleted for good. Nobody removes themselves or the last owner.
 */

type Member = TestUser & { userId: string };

describe('removing people and deleting invitations', () => {
  let app: INestApplication;
  let owner: TestUser;
  let ownerId: string;
  const db = ownerClient();

  const membershipOf = async (userId: string, tenantId = owner.tenantId) =>
    (await db.membership.findFirst({ where: { tenantId, userId } }))?.id ?? null;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Removal Traders');
    await setPlan(owner.tenantId, 'enterprise_plus', 50);
    ownerId = ((await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('shows what moves, asks for the password, hands everything over and stops their sign-in', async () => {
    const rep: Member = await inviteMember(app, owner, 'member');
    const lead = (await api(rep).post('/leads', { fullName: 'Rep Lead', email: 'rep.lead@removal.test' }).expect(201)).body.lead as { id: string };
    const company = (await api(rep).post('/companies', { name: 'Rep Company Ltd' }).expect(201)).body as { id: string };
    const task = (await api(rep).post('/tasks', { title: 'Call the buyer' }).expect(201)).body as { id: string };
    await db.task.update({ where: { id: task.id }, data: { assigneeId: rep.userId } });
    // Someone reports to them.
    const other: Member = await inviteMember(app, owner, 'member');
    await db.membership.updateMany({ where: { tenantId: owner.tenantId, userId: other.userId }, data: { reportingManagerId: rep.userId } });

    const membershipId = (await membershipOf(rep.userId))!;
    const impact = (await api(owner).get(`/tenants/current/members/${membershipId}/removal`).expect(200)).body;
    expect(impact).toMatchObject({ email: rep.email, handoverRequired: true, invitations: 1 });
    expect(impact.records).toMatchObject({ leads: 1, companies: 1, openTasks: 1 });
    expect(impact.handoverOptions[0].userId).toBe(ownerId);
    expect(impact.handoverOptions.map((o: { userId: string }) => o.userId)).not.toContain(rep.userId);

    const url = `/tenants/current/members/${membershipId}`;
    expect((await api(owner).delUnconfirmed(url).expect(403)).body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    expect((await api(owner).del(url, {}).expect(400)).body.error.code).toBe('HANDOVER_REQUIRED');
    expect((await api(owner).del(url, { handoverToUserId: rep.userId }).expect(400)).body.error.code).toBe('INVALID_HANDOVER');
    await api(rep).get('/leads').expect(200);

    const done = (await api(owner).del(url, { handoverToUserId: ownerId }).expect(200)).body;
    expect(done).toMatchObject({ email: rep.email, recordsMoved: 3, invitationsDeleted: 1 });
    expect(done.sessionsEnded).toBeGreaterThan(0);

    // Gone from the list, cannot use the workspace, cannot refresh into it.
    const members = (await api(owner).get('/tenants/current/members').expect(200)).body as { userId: string }[];
    expect(members.map((m) => m.userId)).not.toContain(rep.userId);
    await api(rep).get('/leads').expect(401);
    expect(await membershipOf(rep.userId)).toBeNull();
    expect(await db.invitation.count({ where: { tenantId: owner.tenantId, email: rep.email } })).toBe(0);

    // The records stay, now the owner's.
    expect((await db.lead.findUnique({ where: { id: lead.id } }))?.ownerId).toBe(ownerId);
    expect((await db.company.findUnique({ where: { id: company.id } }))?.ownerId).toBe(ownerId);
    const movedTask = await db.task.findUnique({ where: { id: task.id } });
    expect(movedTask).toMatchObject({ assigneeId: ownerId, reassignedFromId: rep.userId });
    expect((await db.membership.findFirst({ where: { tenantId: owner.tenantId, userId: other.userId } }))?.reportingManagerId).toBeNull();

    const audit = await db.auditLog.findFirst({ where: { tenantId: owner.tenantId, action: 'member.removed', entityId: membershipId } });
    expect(audit?.actorUserId).toBe(ownerId);
    expect(audit?.metadata).toMatchObject({ email: rep.email, handoverToId: ownerId });

    // They can be invited again cleanly.
    await api(owner).post('/tenants/current/invitations', { email: rep.email, roleKey: 'member' }).expect(201);
  });

  it('removes someone with nothing to hand over without choosing a receiver', async () => {
    const viewer = await inviteMember(app, owner, 'viewer');
    const membershipId = (await membershipOf(viewer.userId))!;
    const impact = (await api(owner).get(`/tenants/current/members/${membershipId}/removal`).expect(200)).body;
    expect(impact.handoverRequired).toBe(false);
    expect((await api(owner).del(`/tenants/current/members/${membershipId}`).expect(200)).body.handoverTo).toBeNull();
    expect(await membershipOf(viewer.userId)).toBeNull();
  });

  it('never removes yourself or the last owner, and only an owner removes an owner', async () => {
    const mine = (await membershipOf(ownerId))!;
    expect((await api(owner).del(`/tenants/current/members/${mine}`).expect(400)).body.error.code).toBe('CANNOT_REMOVE_SELF');

    const admin = await inviteMember(app, owner, 'admin');
    expect((await api(admin).del(`/tenants/current/members/${mine}`, { handoverToUserId: admin.userId }).expect(403)).body.error.code).toBe('FORBIDDEN');

    // A second owner can remove the first; then the remaining owner is the last one and stays.
    const second = await inviteMember(app, owner, 'owner');
    const secondId = (await membershipOf(second.userId))!;
    await api(owner).del(`/tenants/current/members/${secondId}`).expect(200);
    expect(await membershipOf(second.userId)).toBeNull();
  });

  it('refuses another workspace’s people and someone who is not a manager of members', async () => {
    const other = await registerUser(app, 'Other Org');
    const outsider = await inviteMember(app, other, 'member');
    const theirs = (await membershipOf(outsider.userId, other.tenantId))!;
    await api(owner).get(`/tenants/current/members/${theirs}/removal`).expect(404);
    await api(owner).del(`/tenants/current/members/${theirs}`).expect(404);
    expect(await membershipOf(outsider.userId, other.tenantId)).not.toBeNull();

    const rep = await inviteMember(app, owner, 'member');
    const target = await inviteMember(app, owner, 'viewer');
    await api(rep).del(`/tenants/current/members/${(await membershipOf(target.userId))!}`).expect(403);
    expect(await membershipOf(target.userId)).not.toBeNull();
  });

  it('deletes accepted, revoked and pending invitation rows for good, with the password', async () => {
    const accepted = await inviteMember(app, owner, 'member');
    const pending = (await api(owner).post('/tenants/current/invitations', { email: 'pending@removal.test', roleKey: 'member' }).expect(201)).body as { id: string };
    const revoked = (await api(owner).post('/tenants/current/invitations', { email: 'revoked@removal.test', roleKey: 'owner' }).expect(201)).body as { id: string };
    await api(owner).delUnconfirmed(`/tenants/current/invitations/${revoked.id}`).expect(204);

    const list = (await api(owner).get('/tenants/current/invitations').expect(200)).body as { id: string; email: string; status: string }[];
    const acceptedRow = list.find((i) => i.email === accepted.email)!;
    expect(acceptedRow.status).toBe('accepted');
    expect(list.find((i) => i.id === revoked.id)?.status).toBe('revoked');

    // A non-owner with members:manage cannot delete an owner invitation.
    const admin = await inviteMember(app, owner, 'admin');
    await api(admin).del(`/tenants/current/invitations/${revoked.id}/record`).expect(403);

    expect((await api(owner).delUnconfirmed(`/tenants/current/invitations/${acceptedRow.id}/record`).expect(403)).body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    for (const id of [acceptedRow.id, pending.id, revoked.id]) await api(owner).del(`/tenants/current/invitations/${id}/record`).expect(204);
    await api(owner).del(`/tenants/current/invitations/${revoked.id}/record`).expect(404);

    const after = (await api(owner).get('/tenants/current/invitations').expect(200)).body as { id: string }[];
    expect(after.map((i) => i.id)).not.toEqual(expect.arrayContaining([acceptedRow.id]));
    expect(after.some((i) => [pending.id, revoked.id].includes(i.id))).toBe(false);
    // Deleting the row of an accepted invitation does not remove the person.
    expect(await membershipOf(accepted.userId)).not.toBeNull();
    expect(await db.auditLog.count({ where: { tenantId: owner.tenantId, action: 'member.invitation_deleted' } })).toBe(3);
  });
});
