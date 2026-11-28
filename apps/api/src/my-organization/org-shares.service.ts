import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { type OrgProfile, type OrgShareRow, type OrgShareSection, type OrgSharedView, type orgShareInputSchema, type z } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { signToken, verifyToken } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { MyOrganizationService, names, ORG_ENTITY } from './my-organization.service';
import { orgAccessOf, visibleAudiences } from './org-access';

interface ShareClaims {
  t: string;
  s: string;
}

/** Profile fields that belong to each section a client may be shown. */
const SECTION_FIELDS: Record<OrgShareSection, (keyof OrgProfile)[]> = {
  overview: ['legalName', 'tagline', 'description', 'businessActivities', 'companyType', 'companySize', 'employeeCount', 'foundedYear', 'brandColors'],
  services: ['services', 'products', 'industriesServed', 'certifications'],
  contact: ['phones', 'emails'],
  addresses: ['registeredAddress', 'offices'],
  links: ['website', 'websiteLinks', 'socialLinks'],
  registration: ['registrationNumber', 'registrationAuthority', 'incorporationDate', 'incorporationCountry'],
  tax: ['taxIds'],
  key_contacts: ['keyContacts'],
};

/**
 * Sharing approved organisation information with clients (ADR 0100). A share is a signed link to one stored share:
 * the approved profile sections and the documents chosen, each approved for clients, until it expires or someone
 * stops it. Credentials are never part of a share, and a document withdrawn from clients drops out of every share at
 * once, because the link is checked against the document as it is now.
 */
@Injectable()
export class OrgSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly org: MyOrganizationService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private get secret(): string {
    return `${this.env.JWT_ACCESS_SECRET}:organization-share`;
  }

  private url(tenantId: string, shareId: string): string {
    const origin = this.env.WEB_ORIGINS.split(',')[0]!.trim().replace(/\/$/, '');
    return `${origin}/shared/organization/${signToken(this.secret, { t: tenantId, s: shareId } satisfies ShareClaims)}`;
  }

  create(auth: AuthContext, input: z.output<typeof orgShareInputSchema>, meta: RequestMeta): Promise<OrgShareRow> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const ids = [...new Set(input.documentIds)];
      const docs = ids.length ? await tx.orgDocument.findMany({ where: { tenantId: auth.tenantId, id: { in: ids }, visibility: { in: visibleAudiences(access) } }, select: { id: true, title: true, clientShareable: true } }) : [];
      if (docs.length !== ids.length) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
      const blocked = docs.filter((d) => !d.clientShareable);
      if (blocked.length) {
        throw new BadRequestException({
          code: 'NOT_APPROVED_FOR_CLIENTS',
          message: 'Only documents approved for client sharing can be shared. Ask a Super or Manager Workspace to approve them first.',
          details: blocked.map((d) => ({ path: 'documentIds', message: d.title })),
        });
      }
      if (input.includeProfile && !(await tx.orgProfile.findUnique({ where: { tenantId: auth.tenantId }, select: { id: true } }))) {
        throw new BadRequestException({ code: 'PROFILE_MISSING', message: 'Set up the organization profile before sharing it.' });
      }
      let company: { id: string; name: string } | null = null;
      if (input.companyId) {
        company = await tx.company.findFirst({ where: { tenantId: auth.tenantId, id: input.companyId, deletedAt: null }, select: { id: true, name: true } });
        if (!company) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Company not found.' });
      }
      const row = await tx.orgShare.create({
        data: {
          tenantId: auth.tenantId,
          documentIds: ids,
          includeProfile: input.includeProfile,
          recipientName: input.recipientName ?? null,
          recipientEmail: input.recipientEmail ?? null,
          companyId: company?.id ?? null,
          message: input.message ?? null,
          expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'organization.shared', entityType: ORG_ENTITY, entityId: auth.tenantId,
        metadata: { shareId: row.id, recipient: input.recipientName ?? input.recipientEmail ?? company?.name ?? null, companyId: company?.id ?? null, includeProfile: input.includeProfile, documents: docs.map((d) => d.title), expiresInDays: input.expiresInDays },
        meta,
      });
      const [out] = await this.rows(tx, auth.tenantId, [row]);
      return { ...out!, url: this.url(auth.tenantId, row.id) };
    });
  }

  /** People who may edit see every share; everyone else sees the shares they made. */
  list(auth: AuthContext): Promise<OrgShareRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const rows = await tx.orgShare.findMany({ where: { tenantId: auth.tenantId, ...(access.canEdit ? {} : { createdById: auth.userId }) }, orderBy: { createdAt: 'desc' }, take: 200 });
      return this.rows(tx, auth.tenantId, rows);
    });
  }

  revoke(auth: AuthContext, id: string, meta: RequestMeta): Promise<OrgShareRow> {
    return this.prisma.run(auth, async (tx) => {
      const access = await orgAccessOf(tx, auth);
      const row = await tx.orgShare.findFirst({ where: { id, tenantId: auth.tenantId, ...(access.canEdit ? {} : { createdById: auth.userId }) } });
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Share not found.' });
      const next = row.revokedAt ? row : await tx.orgShare.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedById: auth.userId } });
      if (!row.revokedAt) {
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'organization.share_revoked', entityType: ORG_ENTITY, entityId: auth.tenantId, metadata: { shareId: row.id, recipient: row.recipientName ?? row.recipientEmail }, meta });
      }
      return (await this.rows(tx, auth.tenantId, [next]))[0]!;
    });
  }

  private async rows(tx: TenantTx, tenantId: string, rows: Awaited<ReturnType<TenantTx['orgShare']['findMany']>>): Promise<OrgShareRow[]> {
    const docIds = [...new Set(rows.flatMap((r) => r.documentIds))];
    const docs = docIds.length ? await tx.orgDocument.findMany({ where: { tenantId, id: { in: docIds } }, select: { id: true, title: true } }) : [];
    const title = new Map(docs.map((d) => [d.id, d.title]));
    const companyIds = [...new Set(rows.map((r) => r.companyId).filter((v): v is string => !!v))];
    const companies = companyIds.length ? await tx.company.findMany({ where: { tenantId, id: { in: companyIds } }, select: { id: true, name: true } }) : [];
    const cName = new Map(companies.map((c) => [c.id, c]));
    const people = await names(tx, rows.map((r) => r.createdById));
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      includeProfile: r.includeProfile,
      documents: r.documentIds.filter((id) => title.has(id)).map((id) => ({ id, title: title.get(id)! })),
      recipientName: r.recipientName,
      recipientEmail: r.recipientEmail,
      company: r.companyId ? (cName.get(r.companyId) ?? null) : null,
      message: r.message,
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      status: r.revokedAt ? 'revoked' : r.expiresAt.getTime() <= now ? 'expired' : 'active',
      views: r.views,
      lastViewedAt: r.lastViewedAt?.toISOString() ?? null,
      createdBy: people.get(r.createdById) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ─── The client's side (no sign-in) ───

  private async open<T>(token: string, fn: (tx: TenantTx, share: NonNullable<Awaited<ReturnType<TenantTx['orgShare']['findFirst']>>>) => Promise<T>): Promise<T> {
    const claims = verifyToken<ShareClaims>(this.secret, token);
    const gone = () => new NotFoundException({ code: 'LINK_EXPIRED', message: 'This link has expired or was stopped. Ask the person who sent it for a new one.' });
    if (!claims?.t || !claims.s) throw gone();
    return this.prisma.run({ tenantId: claims.t }, async (tx) => {
      const share = await tx.orgShare.findFirst({ where: { id: claims.s, tenantId: claims.t } });
      if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) throw gone();
      return fn(tx, share);
    });
  }

  /** Approved documents of a share, as they are now: a document withdrawn from clients or deleted is left out. */
  private sharedDocs(tx: TenantTx, tenantId: string, ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return tx.orgDocument.findMany({ where: { tenantId, id: { in: ids }, clientShareable: true }, orderBy: { title: 'asc' } });
  }

  view(token: string): Promise<OrgSharedView> {
    return this.open(token, async (tx, share) => {
      const profile = await this.org.profileOf(tx, share.tenantId);
      const sections = share.includeProfile ? profile.sharedSections : [];
      const organization: OrgSharedView['organization'] = { brandName: profile.brandName, logoUrl: profile.logoUrl ? profile.logoUrl.replace('/api/v1/organization/logo', `/api/v1/organization-shares/${token}/logo`) : null };
      for (const s of sections) for (const f of SECTION_FIELDS[s]) (organization as Record<string, unknown>)[f] = profile[f];
      const docs = await this.sharedDocs(tx, share.tenantId, share.documentIds);
      const versions = docs.length ? await tx.orgDocumentVersion.findMany({ where: { tenantId: share.tenantId, documentId: { in: docs.map((d) => d.id) } }, select: { documentId: true, version: true, fileName: true, contentType: true, sizeBytes: true } }) : [];
      const by = await names(tx, [share.createdById]);
      await tx.orgShare.update({ where: { id: share.id }, data: { views: { increment: 1 }, lastViewedAt: new Date() } });
      if (share.views === 0) {
        await this.audit.record(tx, { tenantId: share.tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'organization.share_viewed', entityType: ORG_ENTITY, entityId: share.tenantId, metadata: { shareId: share.id, recipient: share.recipientName ?? share.recipientEmail } });
      }
      return {
        organization,
        sections,
        documents: docs.flatMap((d) => {
          const v = versions.find((x) => x.documentId === d.id && x.version === d.currentVersion);
          return v ? [{ id: d.id, title: d.title, category: d.category as OrgSharedView['documents'][number]['category'], description: d.description, issueDate: d.issueDate, expiryDate: d.expiryDate, fileName: v.fileName, contentType: v.contentType, sizeBytes: v.sizeBytes }] : [];
        }),
        message: share.message,
        recipientName: share.recipientName,
        sharedBy: by.get(share.createdById)?.name ?? null,
        expiresAt: share.expiresAt.toISOString(),
      };
    });
  }

  file(token: string, documentId: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    return this.open(token, async (tx, share) => {
      if (!share.documentIds.includes(documentId)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
      const [d] = await this.sharedDocs(tx, share.tenantId, [documentId]);
      if (!d) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
      const v = await tx.orgDocumentVersion.findFirst({ where: { tenantId: share.tenantId, documentId: d.id, version: d.currentVersion } });
      if (!v) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
      return { name: v.fileName, contentType: v.contentType, data: Buffer.from(v.data) };
    });
  }

  logo(token: string): Promise<{ contentType: string; data: Buffer }> {
    return this.open(token, async (tx, share) => {
      const r = await tx.orgProfile.findUnique({ where: { tenantId: share.tenantId }, select: { logoData: true, logoContentType: true } });
      if (!r?.logoData || !r.logoContentType) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No logo yet.' });
      return { contentType: r.logoContentType, data: Buffer.from(r.logoData) };
    });
  }
}
