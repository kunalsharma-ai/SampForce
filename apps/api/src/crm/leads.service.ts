import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type {
  DuplicateCandidate,
  LeadConvertInput,
  LeadConvertResult,
  LeadInput,
  LeadRow,
  ListQuery,
  Page,
  EmailStatus,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, diff, iso, notFound, num, orderBy, ownerRefs, paging, consentFields, assertCampaign, recordStageEvent } from './crm-helpers';
import { CustomFieldsService } from './custom-fields.service';

const SORTABLE = ['fullName', 'companyName', 'status', 'createdAt', 'updatedAt', 'estimatedValue'] as const;
type LeadModel = Prisma.LeadGetPayload<object>;

export function phoneDigits(phone: string | null | undefined): string | null {
  const d = phone?.replace(/\D/g, '') ?? '';
  return d.length >= 6 ? d.slice(-10) : null;
}

export function splitName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
  ) {}

  list(auth: AuthContext, q: ListQuery): Promise<Page<LeadRow>> {
    return this.prisma.run(auth, async (tx) => {
      const status = q.status && ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'].includes(q.status) ? q.status : undefined;
      const where: Prisma.LeadWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        ...(status ? { status: status as LeadModel['status'] } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.q
          ? {
              OR: [
                { fullName: { contains: q.q, mode: 'insensitive' } },
                { email: { contains: q.q, mode: 'insensitive' } },
                { companyName: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.lead.findMany({ where, orderBy: orderBy(q, SORTABLE, 'createdAt'), ...paging(q) }),
        tx.lead.count({ where }),
      ]);
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return { items: rows.map((r) => toLeadRow(r, owners)), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(auth: AuthContext, id: string): Promise<LeadRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await this.find(tx, auth.tenantId, id);
      return toLeadRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  create(auth: AuthContext, input: LeadInput, meta: RequestMeta): Promise<{ lead: LeadRow; duplicates: DuplicateCandidate[] }> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId });
      await assertCampaign(tx, auth.tenantId, input.campaignId);
      const customFields = await this.fields.validate(tx, auth.tenantId, 'LEAD', input.customFields);
      const row = await tx.lead.create({
        data: {
          ...input,
          ...consentFields(input.marketingConsent, 'manual'),
          ownerId,
          tenantId: auth.tenantId,
          tags: input.tags ?? [],
          customFields: (customFields ?? {}) as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead.created', entityType: 'lead', entityId: row.id,
        metadata: { source: row.source }, meta,
      });
      const duplicates = await this.findDuplicates(tx, auth.tenantId, row);
      return { lead: toLeadRow(row, await ownerRefs(tx, [row.ownerId])), duplicates };
    });
  }

  update(auth: AuthContext, id: string, input: Partial<LeadInput>, meta: RequestMeta): Promise<LeadRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.find(tx, auth.tenantId, id);
      if (before.status === 'CONVERTED') {
        throw new ConflictException({ code: 'LEAD_CONVERTED', message: 'Converted leads are read-only. Edit the contact or deal instead.' });
      }
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId });
      await assertCampaign(tx, auth.tenantId, input.campaignId);
      const customFields = await this.fields.validate(tx, auth.tenantId, 'LEAD', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, ...rest } = input;
      const row = await tx.lead.update({
        where: { id },
        data: {
          ...rest,
          ...(input.marketingConsent && input.marketingConsent !== before.marketingConsent ? consentFields(input.marketingConsent, 'manual') : {}),
          ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
          // A new address has not bounced or been checked yet.
          ...(input.email !== undefined && (input.email ?? null) !== before.email ? { emailStatus: null } : {}),
        },
      });
      const changes = diff(before, input);
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId,
        action: changes.ownerId ? 'lead.assigned' : 'lead.updated', entityType: 'lead', entityId: id,
        metadata: { changes }, meta,
      });
      return toLeadRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.lead.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Lead');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead.deleted', entityType: 'lead', entityId: id, meta });
    });
  }

  duplicates(auth: AuthContext, id: string): Promise<DuplicateCandidate[]> {
    return this.prisma.run(auth, async (tx) => this.findDuplicates(tx, auth.tenantId, await this.find(tx, auth.tenantId, id)));
  }

  /** Merges `duplicateId` into `id`: fills empty fields, unions tags, re-links activities and tasks. */
  merge(auth: AuthContext, id: string, duplicateId: string, meta: RequestMeta): Promise<LeadRow> {
    if (id === duplicateId) throw badRef('duplicateId', 'cannot merge a lead into itself');
    return this.prisma.run(auth, async (tx) => {
      const [primary, dup] = await Promise.all([this.find(tx, auth.tenantId, id), this.find(tx, auth.tenantId, duplicateId, 'duplicateId')]);
      if (primary.status === 'CONVERTED' || dup.status === 'CONVERTED') {
        throw new ConflictException({ code: 'LEAD_CONVERTED', message: 'Converted leads cannot be merged.' });
      }
      const fill: Prisma.LeadUpdateInput = {};
      const keys = ['companyName', 'jobTitle', 'industry', 'email', 'phone', 'country', 'city', 'timezone', 'website', 'source', 'campaignSource', 'estimatedValue', 'currency'] as const;
      for (const k of keys) if (primary[k] === null && dup[k] !== null) (fill as Record<string, unknown>)[k] = dup[k];
      fill.tags = [...new Set([...primary.tags, ...dup.tags])];
      fill.customFields = { ...(dup.customFields as object), ...(primary.customFields as object) } as Prisma.InputJsonValue;
      const row = await tx.lead.update({ where: { id }, data: fill });
      await tx.activity.updateMany({ where: { tenantId: auth.tenantId, leadId: duplicateId }, data: { leadId: id } });
      await tx.task.updateMany({ where: { tenantId: auth.tenantId, leadId: duplicateId }, data: { leadId: id } });
      await tx.lead.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead.merged', entityType: 'lead', entityId: id,
        metadata: { mergedLeadId: duplicateId }, meta,
      });
      return toLeadRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  convert(auth: AuthContext, id: string, input: LeadConvertInput, meta: RequestMeta): Promise<LeadConvertResult> {
    return this.prisma.run(auth, async (tx) => {
      const lead = await this.find(tx, auth.tenantId, id);
      if (lead.status === 'CONVERTED') {
        throw new ConflictException({ code: 'LEAD_CONVERTED', message: 'This lead has already been converted.' });
      }
      if (lead.status === 'UNQUALIFIED') {
        throw new BadRequestException({ code: 'LEAD_UNQUALIFIED', message: 'Unqualified leads cannot be converted. Change the status first.' });
      }
      await assertRefs(tx, auth.tenantId, { companyId: input.companyId });
      const ownerId = lead.ownerId ?? auth.userId;

      let companyId = input.companyId ?? null;
      if (!companyId && lead.companyName) {
        const existing = await tx.company.findFirst({
          where: { tenantId: auth.tenantId, deletedAt: null, name: { equals: lead.companyName, mode: 'insensitive' } },
          select: { id: true },
        });
        companyId =
          existing?.id ??
          (await tx.company.create({
            data: { tenantId: auth.tenantId, name: lead.companyName, industry: lead.industry, country: lead.country, domain: lead.website, ownerId },
          })).id;
      }

      const contact = await tx.contact.create({
        data: {
          tenantId: auth.tenantId,
          ...splitName(lead.fullName),
          email: lead.email,
          phone: lead.phone,
          jobTitle: lead.jobTitle,
          country: lead.country,
          timezone: lead.timezone,
          companyId,
          ownerId,
          // Consent travels with the person; the original source and date are kept.
          marketingConsent: lead.marketingConsent,
          consentSource: lead.consentSource,
          consentUpdatedAt: lead.consentUpdatedAt,
        },
      });

      let opportunityId: string | null = null;
      if (input.createDeal) {
        const pipeline = await tx.pipeline.findFirst({
          where: { tenantId: auth.tenantId, deletedAt: null, ...(input.pipelineId ? { id: input.pipelineId } : {}) },
          orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
          include: { stages: { where: { category: 'OPEN' }, orderBy: { position: 'asc' }, take: 1 } },
        });
        if (!pipeline || !pipeline.stages[0]) throw badRef('pipelineId', 'has no open stage');
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } });
        const deal = await tx.opportunity.create({
          data: {
            tenantId: auth.tenantId,
            pipelineId: pipeline.id,
            stageId: pipeline.stages[0].id,
            name: input.dealName ?? `${lead.companyName ?? lead.fullName} opportunity`,
            amount: input.dealAmount ?? lead.estimatedValue ?? 0,
            currency: lead.currency ?? tenant.defaultCurrency,
            companyId,
            contactId: contact.id,
            ownerId,
            sourceLeadId: lead.id,
          },
        });
        await recordStageEvent(tx, { tenantId: auth.tenantId, opportunityId: deal.id, pipelineId: pipeline.id, fromStageId: null, toStageId: deal.stageId, actorUserId: auth.userId });
        opportunityId = deal.id;
      }

      await tx.activity.updateMany({ where: { tenantId: auth.tenantId, leadId: id }, data: { contactId: contact.id, opportunityId } });
      await tx.task.updateMany({ where: { tenantId: auth.tenantId, leadId: id, status: 'OPEN' }, data: { contactId: contact.id, opportunityId } });
      await tx.lead.update({
        where: { id },
        data: { status: 'CONVERTED', convertedAt: new Date(), convertedContactId: contact.id, convertedOpportunityId: opportunityId },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'lead.converted', entityType: 'lead', entityId: id,
        metadata: { contactId: contact.id, companyId, opportunityId }, meta,
      });
      return { leadId: id, contactId: contact.id, companyId, opportunityId };
    });
  }

  private async find(tx: TenantTx, tenantId: string, id: string, field = 'Lead'): Promise<LeadModel> {
    const row = await tx.lead.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!row) throw field === 'Lead' ? notFound('Lead') : badRef(field);
    return row;
  }

  async findDuplicates(tx: TenantTx, tenantId: string, lead: LeadModel): Promise<DuplicateCandidate[]> {
    const out = new Map<string, DuplicateCandidate>();
    const add = (c: DuplicateCandidate) => !out.has(`${c.entity}:${c.id}`) && out.set(`${c.entity}:${c.id}`, c);
    const base = { tenantId, deletedAt: null };
    if (lead.email) {
      const [leads, contacts] = await Promise.all([
        tx.lead.findMany({ where: { ...base, id: { not: lead.id }, email: { equals: lead.email, mode: 'insensitive' } }, take: 10 }),
        tx.contact.findMany({ where: { ...base, email: { equals: lead.email, mode: 'insensitive' } }, take: 10 }),
      ]);
      leads.forEach((l) => add({ id: l.id, entity: 'lead', label: l.fullName, reason: 'email' }));
      contacts.forEach((c) => add({ id: c.id, entity: 'contact', label: [c.firstName, c.lastName].filter(Boolean).join(' '), reason: 'email' }));
    }
    const digits = phoneDigits(lead.phone);
    if (digits) {
      const rows = await tx.lead.findMany({ where: { ...base, id: { not: lead.id }, phoneDigits: digits }, select: { id: true, fullName: true }, take: 10 });
      rows.forEach((r) => add({ id: r.id, entity: 'lead', label: r.fullName, reason: 'phone' }));
    }
    if (lead.companyName) {
      const rows = await tx.lead.findMany({
        where: {
          ...base,
          id: { not: lead.id },
          fullName: { equals: lead.fullName, mode: 'insensitive' },
          companyName: { equals: lead.companyName, mode: 'insensitive' },
        },
        take: 10,
      });
      rows.forEach((l) => add({ id: l.id, entity: 'lead', label: l.fullName, reason: 'name_company' }));
    }
    return [...out.values()];
  }
}

export function toLeadRow(r: LeadModel, owners: Map<string, { id: string; name: string }>): LeadRow {
  return {
    id: r.id,
    fullName: r.fullName,
    companyName: r.companyName,
    jobTitle: r.jobTitle,
    industry: r.industry,
    email: r.email,
    phone: r.phone,
    country: r.country,
    city: r.city,
    source: r.source,
    campaignSource: r.campaignSource,
    campaignId: r.campaignId,
    marketingConsent: r.marketingConsent,
    consentSource: r.consentSource,
    consentUpdatedAt: iso(r.consentUpdatedAt),
    emailStatus: (r.emailStatus as EmailStatus | null) ?? null,
    engagementScore: r.engagementScore,
    estimatedValue: num(r.estimatedValue),
    currency: r.currency,
    status: r.status,
    tags: r.tags,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    customFields: (r.customFields ?? {}) as Record<string, unknown>,
    convertedAt: iso(r.convertedAt),
    convertedContactId: r.convertedContactId,
    convertedOpportunityId: r.convertedOpportunityId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
