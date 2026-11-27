import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  DEFAULT_SHARED_SECTIONS,
  ORG_ACTIVITY_LABELS,
  ORG_DOCUMENT_CATEGORIES,
  ORG_DOCUMENT_MAX_BYTES,
  ORG_DOCUMENT_TYPES,
  ORG_PREVIEW_TYPES,
  ORG_SHARE_SECTIONS,
  type OrgAccess,
  type OrgActivityRow,
  type OrgAddress,
  type OrgCredentialInput,
  type OrgCredentialRow,
  type OrgCredentialSecret,
  type OrgCredentialUpdate,
  type OrgDocumentCategory,
  type OrgDocumentDetail,
  type OrgDocumentMeta,
  type OrgDocumentQuery,
  type OrgDocumentRow,
  type OrgDocumentUpdate,
  type OrgDocumentVisibility,
  type OrgOverview,
  type OrgProfile,
  type OrgProfileInput,
  type OrgShareSection,
  orgCompleteness,
  orgExpiryStatus,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { sniffImage } from '../crm/company-logo-finder';
import { assertCredentials, assertDelete, assertEdit, credentialAudiences, orgAccessOf, visibleAudiences } from './org-access';

type Ref = { id: string; name: string };
type ProfileRow = NonNullable<Awaited<ReturnType<TenantTx['orgProfile']['findUnique']>>>;
type DocRow = NonNullable<Awaited<ReturnType<TenantTx['orgDocument']['findFirst']>>>;

/** Office file types browsers often send without a type, by extension. */
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

export interface UploadedFile {
  name: string;
  contentType: string;
  data: Buffer;
}

/** The organisation's day, for expiry: UTC is close enough for a 30-day warning. */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

export const ORG_ENTITY = 'organization';

/**
 * My Organization (ADR 0100): the organisation's own profile, its documents with versions, its sealed credentials and
 * its activity history. One record per organisation, read by every workspace; what each caller may do comes from
 * orgAccessOf on every call.
 */
@Injectable()
export class MyOrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  private log(tx: TenantTx, auth: AuthContext, action: string, metadata: Record<string, unknown>, meta?: RequestMeta) {
    return this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action, entityType: ORG_ENTITY, entityId: auth.tenantId, metadata, meta });
  }

  // ─── Profile ───

  overview(auth: AuthContext): Promise<OrgOverview> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const profile = await this.profileOf(tx, auth.tenantId);
      const docs = await tx.orgDocument.findMany({ where: { tenantId: auth.tenantId, visibility: { in: visibleAudiences(access) } }, select: { category: true, clientShareable: true, expiryDate: true } });
      const today = todayIso();
      const byCategory: Partial<Record<OrgDocumentCategory, number>> = {};
      let expiringSoon = 0;
      let expired = 0;
      for (const d of docs) {
        const cat = d.category as OrgDocumentCategory;
        byCategory[cat] = (byCategory[cat] ?? 0) + 1;
        const s = orgExpiryStatus(d.expiryDate, today).status;
        if (s === 'expiring') expiringSoon++;
        if (s === 'expired') expired++;
      }
      const audiences = credentialAudiences(access);
      const credentials = audiences.length ? await tx.orgCredential.count({ where: { tenantId: auth.tenantId, access: { in: audiences } } }) : null;
      const active = await tx.orgShare.count({ where: { tenantId: auth.tenantId, revokedAt: null, expiresAt: { gt: new Date() }, ...(access.canEdit ? {} : { createdById: auth.userId }) } });
      return {
        profile,
        access,
        documents: { total: docs.length, shareable: docs.filter((d) => d.clientShareable).length, expiringSoon, expired, byCategory },
        credentials,
        shares: { active },
      };
    });
  }

  async profileOf(tx: TenantTx, tenantId: string): Promise<OrgProfile> {
    const row = await tx.orgProfile.findUnique({ where: { tenantId } });
    if (row) return this.toProfile(tx, row);
    // Before anyone sets it up, the workspace's own name is the starting point.
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const empty: Omit<OrgProfile, 'completeness' | 'missing'> = {
      exists: false, brandName: tenant?.name ?? '', legalName: null, tagline: null, description: null, businessActivities: null, services: [], products: [], industriesServed: [], certifications: [],
      companyType: null, companySize: null, employeeCount: null, foundedYear: null, incorporationDate: null, incorporationCountry: null, registrationNumber: null, registrationAuthority: null,
      taxIds: [], registeredAddress: null, offices: [], phones: [], emails: [], website: null, websiteLinks: [], socialLinks: [], keyContacts: [], moreDetails: [], brandColors: [],
      sharedSections: [...DEFAULT_SHARED_SECTIONS], logoUrl: null, updatedAt: null, updatedBy: null,
    };
    return { ...empty, ...orgCompleteness(empty) };
  }

  private async toProfile(tx: TenantTx, r: ProfileRow): Promise<OrgProfile> {
    const by = r.updatedById ? await tx.user.findUnique({ where: { id: r.updatedById }, select: { id: true, name: true } }) : null;
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    const base: Omit<OrgProfile, 'completeness' | 'missing'> = {
      exists: true,
      brandName: r.brandName,
      legalName: r.legalName,
      tagline: r.tagline,
      description: r.description,
      businessActivities: r.businessActivities,
      services: r.services,
      products: r.products,
      industriesServed: r.industriesServed,
      certifications: r.certifications,
      companyType: r.companyType,
      companySize: r.companySize,
      employeeCount: r.employeeCount,
      foundedYear: r.foundedYear,
      incorporationDate: r.incorporationDate,
      incorporationCountry: r.incorporationCountry,
      registrationNumber: r.registrationNumber,
      registrationAuthority: r.registrationAuthority,
      taxIds: arr(r.taxIds),
      registeredAddress: (r.registeredAddress as OrgAddress | null) ?? null,
      offices: arr(r.offices),
      phones: arr(r.phones),
      emails: arr(r.emails),
      website: r.website,
      websiteLinks: arr(r.websiteLinks),
      socialLinks: arr(r.socialLinks),
      keyContacts: arr(r.keyContacts),
      moreDetails: arr(r.moreDetails),
      brandColors: r.brandColors,
      sharedSections: r.sharedSections.filter((s): s is OrgShareSection => (ORG_SHARE_SECTIONS as readonly string[]).includes(s)),
      logoUrl: r.logoUpdatedAt ? `/api/v1/organization/logo?v=${r.logoUpdatedAt.getTime().toString(36)}` : null,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: by,
    };
    return { ...base, ...orgCompleteness(base) };
  }

  /** Creates the record the first time, then changes only the fields sent. */
  saveProfile(auth: AuthContext, input: OrgProfileInput, meta: RequestMeta): Promise<OrgProfile> {
    return this.prisma.run(auth, async (tx) => {
      assertEdit(await orgAccessOf(tx, auth));
      const before = await tx.orgProfile.findUnique({ where: { tenantId: auth.tenantId } });
      const data = { ...input } as Record<string, unknown>;
      const changed = Object.keys(data);
      if (!before) {
        if (!input.brandName) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'brandName', message: 'Enter your company name' }] });
        await tx.orgProfile.create({
          data: { ...(data as Prisma.OrgProfileUncheckedCreateInput), tenantId: auth.tenantId, brandName: input.brandName, sharedSections: input.sharedSections ?? [...DEFAULT_SHARED_SECTIONS], createdById: auth.userId, updatedById: auth.userId },
        });
        await this.log(tx, auth, 'organization.profile_created', { fields: changed }, meta);
      } else {
        const really = changed.filter((k) => JSON.stringify((before as Record<string, unknown>)[k] ?? null) !== JSON.stringify(data[k] ?? null));
        if (really.length) {
          await tx.orgProfile.update({ where: { tenantId: auth.tenantId }, data: { ...(data as Prisma.OrgProfileUncheckedUpdateInput), updatedById: auth.userId } });
          await this.log(tx, auth, 'organization.profile_updated', { fields: really }, meta);
        }
      }
      return this.profileOf(tx, auth.tenantId);
    });
  }

  logo(auth: AuthContext): Promise<{ contentType: string; data: Buffer }> {
    return this.prisma.run(auth, async (tx) => {
      const r = await tx.orgProfile.findUnique({ where: { tenantId: auth.tenantId }, select: { logoData: true, logoContentType: true } });
      if (!r?.logoData || !r.logoContentType) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No logo yet.' });
      return { contentType: r.logoContentType, data: Buffer.from(r.logoData) };
    });
  }

  uploadLogo(auth: AuthContext, data: Buffer, meta: RequestMeta): Promise<OrgProfile> {
    const sniffed = sniffImage(data);
    if (!sniffed || !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(sniffed.contentType)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_FILE', message: 'Upload a PNG, JPEG, WebP or SVG logo.' });
    }
    return this.prisma.run(auth, async (tx) => {
      assertEdit(await orgAccessOf(tx, auth));
      const exists = await tx.orgProfile.findUnique({ where: { tenantId: auth.tenantId }, select: { id: true } });
      if (!exists) throw new BadRequestException({ code: 'PROFILE_MISSING', message: 'Save the organization profile before adding a logo.' });
      await tx.orgProfile.update({ where: { tenantId: auth.tenantId }, data: { logoData: new Uint8Array(data), logoContentType: sniffed.contentType, logoUpdatedAt: new Date(), updatedById: auth.userId } });
      await this.log(tx, auth, 'organization.logo_uploaded', { size: data.length, type: sniffed.contentType }, meta);
      return this.profileOf(tx, auth.tenantId);
    });
  }

  removeLogo(auth: AuthContext, meta: RequestMeta): Promise<OrgProfile> {
    return this.prisma.run(auth, async (tx) => {
      assertEdit(await orgAccessOf(tx, auth));
      const r = await tx.orgProfile.findUnique({ where: { tenantId: auth.tenantId }, select: { logoUpdatedAt: true } });
      if (r?.logoUpdatedAt) {
        await tx.orgProfile.update({ where: { tenantId: auth.tenantId }, data: { logoData: null, logoContentType: null, logoUpdatedAt: null, updatedById: auth.userId } });
        await this.log(tx, auth, 'organization.logo_removed', {}, meta);
      }
      return this.profileOf(tx, auth.tenantId);
    });
  }

  // ─── Documents ───

  /** Checks an upload and settles its type: the browser's, or from the file name when it sent none. */
  static checkUpload(file: UploadedFile): UploadedFile {
    const name = file.name.trim();
    if (!name || name.length > 200 || /[\\/]/.test(name) || [...name].some((ch) => ch.charCodeAt(0) < 32)) throw new BadRequestException({ code: 'INVALID_NAME', message: 'Give the file a simple name.' });
    if (!file.data.length) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file is empty.' });
    if (file.data.length > ORG_DOCUMENT_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Documents can be up to 15 MB.' });
    let type = file.contentType;
    if (!type || type === 'application/octet-stream') type = BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] ?? type;
    if (!(ORG_DOCUMENT_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_FILE', message: 'Upload a PDF, image, text, CSV, Word, Excel, PowerPoint or ZIP file.' });
    }
    return { name, contentType: type, data: file.data };
  }

  listDocuments(auth: AuthContext, q: OrgDocumentQuery): Promise<OrgDocumentRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const where: Prisma.OrgDocumentWhereInput = { tenantId: auth.tenantId, visibility: { in: visibleAudiences(access) } };
      if (q.category) where.category = q.category;
      if (q.shareable) where.clientShareable = q.shareable === 'true';
      const rows = await tx.orgDocument.findMany({ where, orderBy: { createdAt: 'desc' }, take: 1000 });
      let out = await this.docRows(tx, auth.tenantId, rows);
      if (q.expiry) out = out.filter((d) => d.expiry === q.expiry);
      if (q.q) {
        const needle = q.q.toLowerCase();
        out = out.filter((d) => [d.title, d.description, d.issuer, d.referenceNumber, d.file.fileName, ...d.tags].some((v) => v?.toLowerCase().includes(needle)));
      }
      if (q.sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title));
      if (q.sort === 'expiry') out.sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
      return out;
    });
  }

  private async docRows(tx: TenantTx, tenantId: string, rows: DocRow[]): Promise<OrgDocumentRow[]> {
    if (!rows.length) return [];
    const versions = await tx.orgDocumentVersion.findMany({
      where: { tenantId, documentId: { in: rows.map((r) => r.id) } },
      select: { documentId: true, version: true, fileName: true, contentType: true, sizeBytes: true },
    });
    const people = await names(tx, rows.flatMap((r) => [r.createdById, r.updatedById, r.approvedById]));
    const today = todayIso();
    return rows.map((r) => {
      const mine = versions.filter((v) => v.documentId === r.id);
      const cur = mine.find((v) => v.version === r.currentVersion) ?? mine.sort((a, b) => b.version - a.version)[0];
      const exp = orgExpiryStatus(r.expiryDate, today);
      return {
        id: r.id,
        title: r.title,
        category: ((ORG_DOCUMENT_CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'other') as OrgDocumentCategory,
        description: r.description,
        issuer: r.issuer,
        referenceNumber: r.referenceNumber,
        issueDate: r.issueDate,
        expiryDate: r.expiryDate,
        expiry: exp.status,
        daysLeft: exp.daysLeft,
        tags: r.tags,
        visibility: r.visibility as OrgDocumentVisibility,
        clientShareable: r.clientShareable,
        approvedBy: r.approvedById ? (people.get(r.approvedById) ?? null) : null,
        approvedAt: r.approvedAt?.toISOString() ?? null,
        file: cur
          ? { version: cur.version, fileName: cur.fileName, contentType: cur.contentType, sizeBytes: cur.sizeBytes, previewable: ORG_PREVIEW_TYPES.includes(cur.contentType) }
          : { version: 0, fileName: '', contentType: '', sizeBytes: 0, previewable: false },
        versionCount: mine.length,
        createdBy: r.createdById ? (people.get(r.createdById) ?? null) : null,
        updatedBy: r.updatedById ? (people.get(r.updatedById) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  /** A document the caller may see, or 404 (a document for another audience is not admitted to exist). */
  private async visibleDoc(tx: TenantTx, auth: AuthContext, access: OrgAccess, id: string): Promise<DocRow> {
    const d = await tx.orgDocument.findFirst({ where: { id, tenantId: auth.tenantId, visibility: { in: visibleAudiences(access) } } });
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
    return d;
  }

  document(auth: AuthContext, id: string): Promise<OrgDocumentDetail> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      return this.detail(tx, auth, await this.visibleDoc(tx, auth, access, id));
    });
  }

  private async detail(tx: TenantTx, auth: AuthContext, d: DocRow): Promise<OrgDocumentDetail> {
    const [row] = await this.docRows(tx, auth.tenantId, [d]);
    const versions = await tx.orgDocumentVersion.findMany({
      where: { tenantId: auth.tenantId, documentId: d.id },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, fileName: true, contentType: true, sizeBytes: true, note: true, uploadedById: true, createdAt: true },
    });
    const people = await names(tx, versions.map((v) => v.uploadedById));
    return {
      ...row!,
      versions: versions.map((v) => ({ id: v.id, version: v.version, fileName: v.fileName, contentType: v.contentType, sizeBytes: v.sizeBytes, note: v.note, uploadedBy: v.uploadedById ? (people.get(v.uploadedById) ?? null) : null, createdAt: v.createdAt.toISOString() })),
    };
  }

  uploadDocument(auth: AuthContext, meta0: OrgDocumentMeta, file: UploadedFile, meta: RequestMeta): Promise<OrgDocumentDetail> {
    const f = MyOrganizationService.checkUpload(file);
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      assertEdit(access);
      const visibility = meta0.visibility ?? 'ALL';
      if (!visibleAudiences(access).includes(visibility)) throw new BadRequestException({ code: 'INVALID_SETTING', message: 'You can only keep a document for workspaces you are part of.' });
      const shareable = meta0.clientShareable ?? false;
      const doc = await tx.orgDocument.create({
        data: {
          tenantId: auth.tenantId,
          title: meta0.title,
          category: meta0.category,
          description: meta0.description ?? null,
          issuer: meta0.issuer ?? null,
          referenceNumber: meta0.referenceNumber ?? null,
          issueDate: meta0.issueDate ?? null,
          expiryDate: meta0.expiryDate ?? null,
          tags: meta0.tags ?? [],
          visibility,
          clientShareable: shareable,
          approvedById: shareable ? auth.userId : null,
          approvedAt: shareable ? new Date() : null,
          currentVersion: 1,
          remindedFor: null,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      await tx.orgDocumentVersion.create({ data: versionData(auth, doc.id, 1, f, null) });
      await this.log(tx, auth, 'organization.document_uploaded', { documentId: doc.id, title: doc.title, category: doc.category, fileName: f.name, size: f.data.length, clientShareable: shareable }, meta);
      return this.detail(tx, auth, doc);
    });
  }

  updateDocument(auth: AuthContext, id: string, input: OrgDocumentUpdate, meta: RequestMeta): Promise<OrgDocumentDetail> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      assertEdit(access);
      const d = await this.visibleDoc(tx, auth, access, id);
      if (input.visibility && !visibleAudiences(access).includes(input.visibility)) throw new BadRequestException({ code: 'INVALID_SETTING', message: 'You can only keep a document for workspaces you are part of.' });
      const data: Prisma.OrgDocumentUncheckedUpdateInput = { ...input, updatedById: auth.userId };
      const approving = input.clientShareable !== undefined && input.clientShareable !== d.clientShareable;
      if (approving) Object.assign(data, input.clientShareable ? { approvedById: auth.userId, approvedAt: new Date() } : { approvedById: null, approvedAt: null });
      // The expiry date changed: a new reminder is due for the new date.
      if (input.expiryDate !== undefined && input.expiryDate !== d.expiryDate) data.remindedFor = null;
      const next = await tx.orgDocument.update({ where: { id: d.id }, data });
      const fields = Object.keys(input).filter((k) => k !== 'clientShareable');
      if (fields.length) await this.log(tx, auth, 'organization.document_updated', { documentId: d.id, title: next.title, fields }, meta);
      if (approving) await this.log(tx, auth, input.clientShareable ? 'organization.document_approved' : 'organization.document_unapproved', { documentId: d.id, title: next.title }, meta);
      return this.detail(tx, auth, next);
    });
  }

  /** Replaces the file with a new version. Earlier versions stay, so the record of what was sent before is kept. */
  replaceDocument(auth: AuthContext, id: string, file: UploadedFile, note: string | null, meta: RequestMeta): Promise<OrgDocumentDetail> {
    const f = MyOrganizationService.checkUpload(file);
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      assertEdit(access);
      const d = await this.visibleDoc(tx, auth, access, id);
      const last = await tx.orgDocumentVersion.findFirst({ where: { tenantId: auth.tenantId, documentId: d.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      await tx.orgDocumentVersion.create({ data: versionData(auth, d.id, version, f, note) });
      const next = await tx.orgDocument.update({ where: { id: d.id }, data: { currentVersion: version, updatedById: auth.userId } });
      await this.log(tx, auth, 'organization.document_replaced', { documentId: d.id, title: d.title, version, fileName: f.name, size: f.data.length }, meta);
      return this.detail(tx, auth, next);
    });
  }

  download(auth: AuthContext, id: string, version: number | null, meta: RequestMeta): Promise<{ name: string; contentType: string; data: Buffer }> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const d = await this.visibleDoc(tx, auth, access, id);
      const v = await tx.orgDocumentVersion.findFirst({ where: { tenantId: auth.tenantId, documentId: d.id, version: version ?? d.currentVersion } });
      if (!v) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
      await this.log(tx, auth, 'organization.document_downloaded', { documentId: d.id, title: d.title, version: v.version }, meta);
      return { name: v.fileName, contentType: v.contentType, data: Buffer.from(v.data) };
    });
  }

  removeDocument(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      assertDelete(access);
      const d = await this.visibleDoc(tx, auth, access, id);
      await tx.orgDocumentVersion.deleteMany({ where: { tenantId: auth.tenantId, documentId: d.id } });
      await tx.orgDocument.delete({ where: { id: d.id } });
      await this.log(tx, auth, 'organization.document_deleted', { documentId: d.id, title: d.title, category: d.category }, meta);
    });
  }

  // ─── Credentials ───

  listCredentials(auth: AuthContext): Promise<OrgCredentialRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const audiences = credentialAudiences(await orgAccessOf(tx, auth));
      if (!audiences.length) return [];
      const rows = await tx.orgCredential.findMany({ where: { tenantId: auth.tenantId, access: { in: audiences } }, orderBy: { createdAt: 'desc' }, take: 500 });
      const people = await names(tx, rows.map((r) => r.updatedById));
      return rows.map((r) => credentialRow(r, people));
    });
  }

  addCredential(auth: AuthContext, input: OrgCredentialInput, meta: RequestMeta): Promise<OrgCredentialRow> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      assertCredentials(access);
      const level = input.access ?? 'SUPER';
      if (!credentialAudiences(access).includes(level)) throw new BadRequestException({ code: 'INVALID_SETTING', message: 'You can only keep a credential for workspaces you are part of.' });
      const row = await tx.orgCredential.create({
        data: {
          tenantId: auth.tenantId,
          label: input.label,
          kind: input.kind,
          url: input.url ?? null,
          username: input.username ?? null,
          secretSealed: input.secret ? this.box.seal(input.secret) : null,
          notesSealed: input.notes ? this.box.seal(input.notes) : null,
          access: level,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      await this.log(tx, auth, 'organization.credential_added', { credentialId: row.id, label: row.label, kind: row.kind, access: level }, meta);
      return credentialRow(row, await names(tx, [auth.userId]));
    });
  }

  private async visibleCredential(tx: TenantTx, auth: AuthContext, access: OrgAccess, id: string) {
    const row = await tx.orgCredential.findFirst({ where: { id, tenantId: auth.tenantId, access: { in: credentialAudiences(access) } } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Credential not found.' });
    return row;
  }

  updateCredential(auth: AuthContext, id: string, input: OrgCredentialUpdate, meta: RequestMeta): Promise<OrgCredentialRow> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      assertCredentials(access);
      const row = await this.visibleCredential(tx, auth, access, id);
      if (input.access && !credentialAudiences(access).includes(input.access)) throw new BadRequestException({ code: 'INVALID_SETTING', message: 'You can only keep a credential for workspaces you are part of.' });
      const data: Prisma.OrgCredentialUncheckedUpdateInput = { updatedById: auth.userId };
      if (input.label !== undefined) data.label = input.label;
      if (input.kind !== undefined) data.kind = input.kind;
      if (input.url !== undefined) data.url = input.url;
      if (input.username !== undefined) data.username = input.username;
      if (input.access !== undefined) data.access = input.access;
      if (input.notes !== undefined) data.notesSealed = input.notes ? this.box.seal(input.notes) : null;
      if (input.secret) data.secretSealed = this.box.seal(input.secret);
      else if (input.clearSecret) data.secretSealed = null;
      const next = await tx.orgCredential.update({ where: { id: row.id }, data });
      // Which fields changed, never their values.
      const fields = Object.keys(input).filter((k) => k !== 'clearSecret').concat(input.clearSecret ? ['secret'] : []);
      await this.log(tx, auth, 'organization.credential_updated', { credentialId: row.id, label: next.label, fields: [...new Set(fields)] }, meta);
      return credentialRow(next, await names(tx, [auth.userId]));
    });
  }

  /** Opens the sealed secret for one person, once, and writes it in the history. */
  reveal(auth: AuthContext, id: string, meta: RequestMeta): Promise<OrgCredentialSecret> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const row = await this.visibleCredential(tx, auth, access, id);
      await tx.orgCredential.update({ where: { id: row.id }, data: { lastRevealedAt: new Date() } });
      await this.log(tx, auth, 'organization.credential_revealed', { credentialId: row.id, label: row.label }, meta);
      return { secret: row.secretSealed ? this.box.open(row.secretSealed) : null, notes: row.notesSealed ? this.box.open(row.notesSealed) : null };
    });
  }

  removeCredential(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      assertCredentials(access);
      assertDelete(access);
      const row = await this.visibleCredential(tx, auth, access, id);
      await tx.orgCredential.delete({ where: { id: row.id } });
      await this.log(tx, auth, 'organization.credential_deleted', { credentialId: row.id, label: row.label }, meta);
    });
  }

  // ─── Activity history ───

  activity(auth: AuthContext, limit: number): Promise<OrgActivityRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const rows = await tx.auditLog.findMany({
        where: { tenantId: auth.tenantId, entityType: ORG_ENTITY, entityId: auth.tenantId, outcome: 'DONE' },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 200) * 2,
      });
      // People who may not see credentials do not see what happens to them either.
      const shown = rows.filter((r) => access.canSeeCredentials || !r.action.startsWith('organization.credential_')).slice(0, Math.min(Math.max(limit, 1), 200));
      const people = await names(tx, shown.map((r) => r.actorUserId));
      return shown.map((r) => {
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        const subject = typeof m.title === 'string' ? m.title : typeof m.label === 'string' ? m.label : typeof m.recipient === 'string' ? m.recipient : null;
        return {
          id: r.id,
          action: r.action,
          label: ORG_ACTIVITY_LABELS[r.action] ?? r.action,
          actor: r.actorUserId ? (people.get(r.actorUserId) ?? null) : null,
          subject,
          details: m,
          createdAt: r.createdAt.toISOString(),
        };
      });
    });
  }
}

function versionData(auth: AuthContext, documentId: string, version: number, f: UploadedFile, note: string | null): Prisma.OrgDocumentVersionUncheckedCreateInput {
  return {
    tenantId: auth.tenantId,
    documentId,
    version,
    fileName: f.name,
    contentType: f.contentType,
    sizeBytes: f.data.length,
    data: new Uint8Array(f.data),
    sha256: createHash('sha256').update(f.data).digest('hex'),
    note,
    uploadedById: auth.userId,
  };
}

function credentialRow(r: NonNullable<Awaited<ReturnType<TenantTx['orgCredential']['findFirst']>>>, people: Map<string, Ref>): OrgCredentialRow {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind as OrgCredentialRow['kind'],
    url: r.url,
    username: r.username,
    hasSecret: !!r.secretSealed,
    hasNotes: !!r.notesSealed,
    access: r.access as OrgCredentialRow['access'],
    lastRevealedAt: r.lastRevealedAt?.toISOString() ?? null,
    updatedBy: r.updatedById ? (people.get(r.updatedById) ?? null) : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function names(tx: TenantTx, ids: (string | null | undefined)[]): Promise<Map<string, Ref>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u]));
}
