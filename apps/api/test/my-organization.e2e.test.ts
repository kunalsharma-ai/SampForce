import type { INestApplication } from '@nestjs/common';
import type { OrgActivityRow, OrgCredentialRow, OrgDocumentDetail, OrgDocumentRow, OrgOverview, OrgShareRow, OrgSharedView } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgExpiryRemindersService } from '../src/my-organization/org-expiry-reminders.service';
import { api, asTenant, confirmationFor, ORIGIN, ownerClient, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000040000000400806000000aa6971de0000000049454e44ae426082', 'hex');

function upload(user: TestUser, path: string, query: Record<string, string>, body: Buffer, type = 'application/pdf') {
  return user.agent[path.endsWith('/logo') ? 'put' : 'post'](`/api/v1${path}`).set('origin', ORIGIN).set('content-type', type).query(query).send(body);
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * My Organization (ADR 0100): one shared record of the organisation's own company, its documents with versions and
 * expiry, sealed credentials, client shares and the activity history, with who-may-do-what enforced on the server.
 */
describe('my organization', () => {
  let app: INestApplication;
  let owner: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let executive: TestUser & { userId: string; workspaceId: string };
  let iso: OrgDocumentDetail;
  let internal: OrgDocumentDetail;
  let shareUrl = '';
  const db = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork');
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 3, maxExecutiveWorkspaces: 3 } });
    manager = await workspacePerson(app, owner, 'MANAGER', 'Neha Manager');
    executive = await workspacePerson(app, owner, 'EXECUTIVE', 'Arun Executive');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('starts empty with the workspace name, and tells each level what it may do', async () => {
    const o = (await api(owner).get('/organization').expect(200)).body as OrgOverview;
    expect(o.profile.exists).toBe(false);
    expect(o.profile.brandName).toBe('Frequent Research Fieldwork');
    expect(o.access).toMatchObject({ level: 'SUPER', canEdit: true, canDelete: true, canManageCredentials: true, canSeeCredentials: true });
    const m = (await api(manager).get('/organization').expect(200)).body as OrgOverview;
    // Managers edit by default; Delete stays off below the Super Workspace until it is handed down (W2).
    expect(m.access).toMatchObject({ level: 'MANAGER', canEdit: true, canDelete: false, canSeeCredentials: true });
    const e = (await api(executive).get('/organization').expect(200)).body as OrgOverview;
    expect(e.access).toMatchObject({ level: 'EXECUTIVE', canEdit: false, canDelete: false, canManageCredentials: false, canSeeCredentials: false, canShare: true });
    expect(e.credentials).toBeNull();
  });

  it('lets the Super Workspace create the profile, and every workspace reads the same record', async () => {
    const saved = (
      await api(owner)
        .put('/organization/profile', {
          brandName: 'Frequent Research',
          legalName: 'Frequent Research Fieldwork Pvt. Ltd.',
          tagline: 'Fieldwork you can trust',
          description: 'Market research data collection across 40 countries.',
          services: ['Online surveys', 'CATI', 'Online surveys'],
          registrationNumber: 'U74999MH2015PTC123456',
          incorporationDate: '2015-04-01',
          incorporationCountry: 'in',
          taxIds: [{ label: 'GSTIN', value: '27AABCF1234A1Z5' }],
          registeredAddress: { country: 'IN', city: 'Mumbai', address: '5th floor, Andheri East', postalCode: '400069' },
          offices: [{ label: 'Delhi', country: 'IN', city: 'New Delhi' }],
          phones: [{ value: '+91 22 4000 1000', label: 'Main' }],
          emails: [{ value: 'Sales@FrequentResearch.example', label: 'Sales' }],
          website: 'frequentresearch.example',
          websiteLinks: [{ label: 'Case studies', url: 'https://frequentresearch.example/cases' }],
          socialLinks: [{ platform: 'linkedin', url: 'https://www.linkedin.com/company/frequent-research' }],
          keyContacts: [{ name: 'Kunal Sharma', designation: 'Director', email: 'kunal@frequentresearch.example' }],
        })
        .expect(200)
    ).body;
    expect(saved.exists).toBe(true);
    expect(saved.services).toEqual(['Online surveys', 'CATI']);
    expect(saved.website).toBe('https://frequentresearch.example');
    expect(saved.emails[0].value).toBe('sales@frequentresearch.example');
    expect(saved.incorporationCountry).toBe('IN');
    expect(saved.sharedSections).toEqual(['overview', 'services', 'contact', 'addresses', 'links']);
    expect(saved.completeness).toBeGreaterThan(70);
    expect(saved.missing).toContain('Logo');

    const forExec = (await api(executive).get('/organization').expect(200)).body as OrgOverview;
    expect(forExec.profile.legalName).toBe('Frequent Research Fieldwork Pvt. Ltd.');
    expect(forExec.profile.updatedBy?.name).toBeTruthy();
  });

  it('refuses an executive edit on the server, and lets a manager edit', async () => {
    expect((await api(executive).put('/organization/profile', { tagline: 'Changed by exec' }).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    await api(manager).put('/organization/profile', { tagline: 'Fieldwork you can trust, worldwide' }).expect(200);
    expect((await api(owner).get('/organization').expect(200)).body.profile.tagline).toBe('Fieldwork you can trust, worldwide');
    // Validation is the same for everyone.
    expect((await api(owner).put('/organization/profile', { website: 'not a url at all' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('keeps a logo, checked from its bytes', async () => {
    await upload(manager, '/organization/logo', {}, PNG, 'image/png').expect(200);
    await upload(owner, '/organization/logo', {}, Buffer.from('<html>nope</html>'), 'image/png').expect(400);
    const p = (await api(executive).get('/organization').expect(200)).body.profile;
    expect(p.logoUrl).toMatch(/^\/api\/v1\/organization\/logo\?v=/);
    const img = await executive.agent.get('/api/v1/organization/logo').expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    await upload(executive, '/organization/logo', {}, PNG, 'image/png').expect(403);
  });

  it('uploads documents with categories, dates and audiences', async () => {
    iso = (
      await upload(owner, '/organization/documents', { name: 'ISO-20252.pdf', meta: JSON.stringify({ title: 'ISO 20252 certificate', category: 'certification', issuer: 'TÜV', issueDate: day(-300), expiryDate: day(20), clientShareable: true, tags: ['ISO', 'quality'] }) }, PDF).expect(201)
    ).body;
    expect(iso).toMatchObject({ title: 'ISO 20252 certificate', category: 'certification', expiry: 'expiring', clientShareable: true, visibility: 'ALL', versionCount: 1 });
    expect(iso.file).toMatchObject({ version: 1, fileName: 'ISO-20252.pdf', contentType: 'application/pdf', previewable: true });
    expect(iso.approvedBy).not.toBeNull();

    internal = (await upload(manager, '/organization/documents', { name: 'bank-letter.pdf', meta: JSON.stringify({ title: 'Bank letter', category: 'financial', visibility: 'MANAGERS' }) }, PDF).expect(201)).body;
    expect(internal.clientShareable).toBe(false);
    // A file named for its type when the browser sends none.
    const deck = (await upload(owner, '/organization/documents', { name: 'Company deck.pptx', meta: JSON.stringify({ title: 'Company presentation', category: 'presentation', expiryDate: day(-2) }) }, Buffer.from('PK\u0003\u0004deck'), 'application/octet-stream').expect(201)).body;
    expect(deck.file.contentType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(deck.expiry).toBe('expired');

    // Not every file: HTML is refused, and so is a manager keeping a document from themselves.
    await upload(owner, '/organization/documents', { name: 'page.html', meta: JSON.stringify({ title: 'Page', category: 'other' }) }, Buffer.from('<html></html>'), 'text/html').expect(400);
    await upload(manager, '/organization/documents', { name: 'x.pdf', meta: JSON.stringify({ title: 'Secret', category: 'legal', visibility: 'SUPER' }) }, PDF).expect(400);
    await upload(owner, '/organization/documents', { name: 'x.pdf', meta: JSON.stringify({ title: 'Bad dates', category: 'legal', issueDate: day(5), expiryDate: day(1) }) }, PDF).expect(400);
    expect((await upload(executive, '/organization/documents', { name: 'x.pdf', meta: JSON.stringify({ title: 'Exec doc', category: 'other' }) }, PDF).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
  });

  it('shows each workspace only the documents meant for it, with search and filters', async () => {
    const all = (await api(owner).get('/organization/documents').expect(200)).body as OrgDocumentRow[];
    expect(all.map((d) => d.title).sort()).toEqual(['Bank letter', 'Company presentation', 'ISO 20252 certificate']);
    const forExec = (await api(executive).get('/organization/documents').expect(200)).body as OrgDocumentRow[];
    expect(forExec.map((d) => d.title)).not.toContain('Bank letter');
    await api(executive).get(`/organization/documents/${internal.id}`).expect(404);
    await executive.agent.get(`/api/v1/organization/documents/${internal.id}/file`).expect(404);

    expect(((await api(owner).get('/organization/documents?q=tüv').expect(200)).body as OrgDocumentRow[]).map((d) => d.title)).toEqual(['ISO 20252 certificate']);
    expect(((await api(owner).get('/organization/documents?q=quality').expect(200)).body as OrgDocumentRow[]).length).toBe(1);
    expect(((await api(owner).get('/organization/documents?category=financial').expect(200)).body as OrgDocumentRow[]).map((d) => d.title)).toEqual(['Bank letter']);
    expect(((await api(owner).get('/organization/documents?expiry=expired').expect(200)).body as OrgDocumentRow[]).map((d) => d.title)).toEqual(['Company presentation']);
    expect(((await api(owner).get('/organization/documents?shareable=true').expect(200)).body as OrgDocumentRow[]).map((d) => d.title)).toEqual(['ISO 20252 certificate']);

    const o = (await api(owner).get('/organization').expect(200)).body as OrgOverview;
    expect(o.documents).toMatchObject({ total: 3, shareable: 1, expiringSoon: 1, expired: 1 });
    expect(((await api(executive).get('/organization').expect(200)).body as OrgOverview).documents.total).toBe(2);
  });

  it('previews and downloads, and replaces a document while keeping earlier versions', async () => {
    const inline = await executive.agent.get(`/api/v1/organization/documents/${iso.id}/file?inline=1`).expect(200);
    expect(inline.headers['content-disposition']).toMatch(/^inline/);
    // An inline PDF is framed by the page (same origin only) and needs the browser's viewer, so it is not sandboxed.
    expect(inline.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(inline.headers['content-security-policy']).not.toContain('sandbox');
    const saved = await executive.agent.get(`/api/v1/organization/documents/${iso.id}/file`).expect(200);
    expect(saved.headers['content-security-policy']).toContain('sandbox');
    expect(saved.headers['content-disposition']).toMatch(/^attachment; filename="ISO-20252.pdf"/);

    const v2 = (await upload(owner, `/organization/documents/${iso.id}/versions`, { name: 'ISO-20252-2027.pdf', note: 'Renewed for 2027' }, Buffer.concat([PDF, Buffer.from('% v2')])).expect(201)).body as OrgDocumentDetail;
    expect(v2.file).toMatchObject({ version: 2, fileName: 'ISO-20252-2027.pdf' });
    expect(v2.versions.map((v) => [v.version, v.note])).toEqual([[2, 'Renewed for 2027'], [1, null]]);
    const old = await owner.agent.get(`/api/v1/organization/documents/${iso.id}/file?version=1`).expect(200);
    expect(old.headers['content-disposition']).toContain('ISO-20252.pdf');
    await upload(executive, `/organization/documents/${iso.id}/versions`, { name: 'x.pdf' }, PDF).expect(403);

    const edited = (await api(manager).patch(`/organization/documents/${iso.id}`, { expiryDate: day(400), description: 'Valid for all online and CATI work' }).expect(200)).body as OrgDocumentDetail;
    expect(edited.expiry).toBe('valid');
  });

  it('keeps credentials sealed, for the workspaces they are meant for, never for executives', async () => {
    const portal = (await api(owner).post('/organization/credentials', { label: 'GST portal', kind: 'tax_portal', url: 'gst.gov.in', username: 'frequent-gst', secret: 'S3cret!pass', notes: 'OTP goes to the director', access: 'SUPER' }).expect(201)).body as OrgCredentialRow;
    expect(portal).toMatchObject({ hasSecret: true, hasNotes: true, access: 'SUPER', url: 'https://gst.gov.in' });
    expect(JSON.stringify(portal)).not.toContain('S3cret');
    const shared = (await api(manager).post('/organization/credentials', { label: 'ESOMAR membership', kind: 'membership_id', username: 'ESO-55120', access: 'MANAGERS' }).expect(201)).body as OrgCredentialRow;
    await api(manager).post('/organization/credentials', { label: 'Bank', kind: 'bank', access: 'SUPER' }).expect(400);

    const stored = await asTenant(owner.tenantId, (tx) => tx.orgCredential.findFirst({ where: { id: portal.id } }));
    expect(stored!.secretSealed).toMatch(/^v1\./);
    expect(stored!.secretSealed).not.toContain('S3cret');

    expect(((await api(owner).get('/organization/credentials').expect(200)).body as OrgCredentialRow[]).length).toBe(2);
    expect(((await api(manager).get('/organization/credentials').expect(200)).body as OrgCredentialRow[]).map((c) => c.label)).toEqual(['ESOMAR membership']);
    expect((await api(executive).get('/organization/credentials').expect(200)).body).toEqual([]);
    await api(executive).post('/organization/credentials', { label: 'Exec', kind: 'other' }).expect(403);

    // Revealing asks for the password, and only works for someone who may see it.
    await owner.agent.post(`/api/v1/organization/credentials/${portal.id}/reveal`).set('origin', ORIGIN).expect(403);
    const pass = await confirmationFor(owner);
    const open = (await owner.agent.post(`/api/v1/organization/credentials/${portal.id}/reveal`).set('origin', ORIGIN).set('x-password-confirmation', pass).expect(200)).body;
    expect(open).toEqual({ secret: 'S3cret!pass', notes: 'OTP goes to the director' });
    const mPass = await confirmationFor(manager);
    await manager.agent.post(`/api/v1/organization/credentials/${portal.id}/reveal`).set('origin', ORIGIN).set('x-password-confirmation', mPass).expect(404);

    // Changing the label keeps the secret; deleting needs Delete, which managers do not have yet.
    const renamed = (await api(owner).patch(`/organization/credentials/${portal.id}`, { label: 'GST portal (main)' }).expect(200)).body as OrgCredentialRow;
    expect(renamed.hasSecret).toBe(true);
    expect((await api(manager).del(`/organization/credentials/${shared.id}`).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    await api(owner).del(`/organization/credentials/${shared.id}`).expect(204);
  });

  it('shares only approved items with a client, through a link that can expire or be stopped', async () => {
    const refused = await api(executive).post('/organization/shares', { documentIds: [iso.id, internal.id] }).expect(404);
    expect(refused.body.error.code).toBe('NOT_FOUND');
    const deck = ((await api(owner).get('/organization/documents?q=presentation').expect(200)).body as OrgDocumentRow[])[0]!;
    expect((await api(executive).post('/organization/shares', { documentIds: [deck.id] }).expect(400)).body.error.code).toBe('NOT_APPROVED_FOR_CLIENTS');

    const made = (await api(executive).post('/organization/shares', { documentIds: [iso.id], recipientName: 'Priya at Acme', recipientEmail: 'priya@acme.example', message: 'Our ISO certificate, as promised.', expiresInDays: 3 }).expect(201)).body as OrgShareRow;
    expect(made.url).toMatch(/^http:\/\/localhost:3000\/shared\/organization\/.+/);
    expect(made.status).toBe('active');
    shareUrl = made.url!;
    const token = shareUrl.split('/shared/organization/')[1]!;

    const anon = request(app.getHttpServer());
    const view = (await anon.get(`/api/v1/organization-shares/${token}`).expect(200)).body as OrgSharedView;
    expect(view.organization.brandName).toBe('Frequent Research');
    expect(view.organization.website).toBe('https://frequentresearch.example');
    // Sections not approved for clients stay out: registration, tax IDs and key contacts.
    expect(view.organization.taxIds).toBeUndefined();
    expect(view.organization.registrationNumber).toBeUndefined();
    expect(view.organization.keyContacts).toBeUndefined();
    expect(view.organization.logoUrl).toContain(`/api/v1/organization-shares/${token}/logo`);
    expect(view.documents.map((d) => d.title)).toEqual(['ISO 20252 certificate']);
    expect(view.sharedBy).toBe('Arun Executive');
    expect(JSON.stringify(view)).not.toContain('S3cret');
    await anon.get(`/api/v1/organization-shares/${token}/logo`).expect(200);
    const file = await anon.get(`/api/v1/organization-shares/${token}/documents/${iso.id}`).expect(200);
    expect(file.headers['content-disposition']).toContain('ISO-20252-2027.pdf');
    await anon.get(`/api/v1/organization-shares/${token}/documents/${internal.id}`).expect(404);
    await anon.get(`/api/v1/organization-shares/${token.slice(0, -2)}xx`).expect(404);

    // Approving more sections shows them; withdrawing a document from clients takes it out of live links at once.
    await api(owner).put('/organization/profile', { sharedSections: ['overview', 'links', 'registration'] }).expect(200);
    const again = (await anon.get(`/api/v1/organization-shares/${token}`).expect(200)).body as OrgSharedView;
    expect(again.organization.registrationNumber).toBe('U74999MH2015PTC123456');
    expect(again.organization.phones).toBeUndefined();
    await api(manager).patch(`/organization/documents/${iso.id}`, { clientShareable: false }).expect(200);
    expect(((await anon.get(`/api/v1/organization-shares/${token}`).expect(200)).body as OrgSharedView).documents).toEqual([]);
    await anon.get(`/api/v1/organization-shares/${token}/documents/${iso.id}`).expect(404);
    await api(manager).patch(`/organization/documents/${iso.id}`, { clientShareable: true }).expect(200);

    // The executive sees their own shares; managers see everyone's and can stop them.
    expect(((await api(executive).get('/organization/shares').expect(200)).body as OrgShareRow[]).length).toBe(1);
    const listed = ((await api(manager).get('/organization/shares').expect(200)).body as OrgShareRow[])[0]!;
    expect(listed.views).toBeGreaterThanOrEqual(1);
    expect(listed.documents.map((d) => d.title)).toEqual(['ISO 20252 certificate']);
    expect((await api(manager).post(`/organization/shares/${made.id}/revoke`).expect(200)).body.status).toBe('revoked');
    expect((await anon.get(`/api/v1/organization-shares/${token}`).expect(404)).body.error.code).toBe('LINK_EXPIRED');
    expect((await api(executive).get('/organization/shares').expect(200)).body[0].status).toBe('revoked');
  });

  it('deletes only with Delete and the password, and keeps everything in the activity history', async () => {
    expect((await api(manager).del(`/organization/documents/${internal.id}`).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    await api(owner).delUnconfirmed(`/organization/documents/${internal.id}`).expect(403);
    // The Super Workspace hands Delete on Administration down to the manager (Permission Center).
    const before = (await api(manager).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { actions: { ...before, Administration: [...(before.Administration ?? []), 'delete'] } }).expect(200);
    await api(manager).del(`/organization/documents/${internal.id}`).expect(204);
    await api(owner).get(`/organization/documents/${internal.id}`).expect(404);
    expect(await asTenant(owner.tenantId, (tx) => tx.orgDocumentVersion.count({ where: { documentId: internal.id } }))).toBe(0);

    const history = (await api(owner).get('/organization/activity?limit=100').expect(200)).body as OrgActivityRow[];
    const actions = history.map((h) => h.action);
    for (const a of [
      'organization.profile_created',
      'organization.profile_updated',
      'organization.logo_uploaded',
      'organization.document_uploaded',
      'organization.document_replaced',
      'organization.document_updated',
      'organization.document_unapproved',
      'organization.document_approved',
      'organization.document_downloaded',
      'organization.credential_added',
      'organization.credential_revealed',
      'organization.credential_deleted',
      'organization.shared',
      'organization.share_viewed',
      'organization.share_revoked',
      'organization.document_deleted',
    ])
      expect(actions, a).toContain(a);
    const deleted = history.find((h) => h.action === 'organization.document_deleted')!;
    expect(deleted).toMatchObject({ label: 'Deleted a document', subject: 'Bank letter', actor: { name: 'Neha Manager' } });
    expect(JSON.stringify(history)).not.toContain('S3cret');
    // Executives see the history without what happened to credentials.
    const execHistory = (await api(executive).get('/organization/activity').expect(200)).body as OrgActivityRow[];
    expect(execHistory.some((h) => h.action.startsWith('organization.credential_'))).toBe(false);
    expect(execHistory.some((h) => h.action === 'organization.shared')).toBe(true);
  });

  it('lets the Super Workspace hand editing down to an executive', async () => {
    const before = (await api(executive).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    await api(owner).put(`/workspaces/${executive.workspaceId}/permissions`, { actions: { ...before, Administration: ['view', 'edit'] } }).expect(200);
    const access = ((await api(executive).get('/organization').expect(200)).body as OrgOverview).access;
    expect(access).toMatchObject({ canEdit: true, canDelete: false, canSeeCredentials: false });
    await api(executive).put('/organization/profile', { tagline: 'Edited by a trusted executive' }).expect(200);
    expect((await api(executive).get('/organization/credentials').expect(200)).body).toEqual([]);
  });

  it('reminds the people who keep documents up to date before a document expires, once per stage', async () => {
    const soon = (await upload(owner, '/organization/documents', { name: 'iso27001.pdf', meta: JSON.stringify({ title: 'ISO 27001', category: 'certification', expiryDate: day(5) }) }, PDF).expect(201)).body as OrgDocumentDetail;
    const reminders = app.get(OrgExpiryRemindersService);
    await reminders.sweep(new Date(), true);
    const notes = async (user: TestUser) => ((await api(user).get('/notifications?pageSize=50').expect(200)).body.items as { title: string }[]).map((n) => n.title);
    expect(await notes(owner)).toContain('Document expires within a week: ISO 27001');
    expect(await notes(manager)).toContain('Document expires within a week: ISO 27001');
    expect(await notes(executive)).not.toContain('Document expires within a week: ISO 27001');
    await reminders.sweep(new Date(), true);
    expect((await notes(owner)).filter((t) => t === 'Document expires within a week: ISO 27001').length).toBe(1);
    // A renewed expiry date starts the reminders again only when it comes close.
    await api(owner).patch(`/organization/documents/${soon.id}`, { expiryDate: day(200) }).expect(200);
    expect(await asTenant(owner.tenantId, (tx) => tx.orgDocument.findFirst({ where: { id: soon.id }, select: { remindedFor: true } }))).toEqual({ remindedFor: null });
  });
});
