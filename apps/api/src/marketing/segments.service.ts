import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { SegmentEntity, SegmentInput, SegmentPreview, SegmentRow, SegmentRule, SegmentRules } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { toCsv } from '../crm/csv';

type Where = Record<string, unknown>;
const DAY = 86_400_000;
const TEXT_FIELDS: Record<string, string> = { source: 'source', campaignSource: 'campaignSource', industry: 'industry', country: 'country', jobTitle: 'jobTitle' };
const NUMBER_FIELDS: Record<string, string> = { estimatedValue: 'estimatedValue', aiScore: 'aiScore' };

/** Translates one validated rule into a Prisma filter. Fields come from SEGMENT_FIELDS only. */
function ruleWhere(r: SegmentRule): Where {
  const v = r.value;
  if (r.field === 'status' || r.field === 'marketingConsent') return r.op === 'eq' ? { [r.field]: v } : { NOT: { [r.field]: v } };
  if (r.field === 'tags') return r.op === 'has' ? { tags: { has: String(v) } } : { NOT: { tags: { has: String(v) } } };
  if (r.field === 'createdWithinDays') return { createdAt: { gte: new Date(Date.now() - Number(v) * DAY) } };
  if (r.field === 'hasEmail') return r.op === 'is_true' ? { AND: [{ email: { not: null } }, { NOT: { email: '' } }] } : { OR: [{ email: null }, { email: '' }] };
  if (r.field === 'hasCompany') return r.op === 'is_true' ? { companyId: { not: null } } : { companyId: null };
  const num = NUMBER_FIELDS[r.field];
  if (num) return { [num]: r.op === 'gte' ? { gte: Number(v) } : { lte: Number(v) } };
  const col = TEXT_FIELDS[r.field]!;
  const value = r.field === 'country' ? String(v ?? '').toUpperCase() : String(v ?? '');
  switch (r.op) {
    case 'eq': return { [col]: { equals: value, mode: 'insensitive' } };
    case 'contains': return { [col]: { contains: value, mode: 'insensitive' } };
    case 'is_empty': return { OR: [{ [col]: null }, { [col]: '' }] };
    default: return { AND: [{ [col]: { not: null } }, { NOT: { [col]: '' } }] };
  }
}

export function segmentWhere(tenantId: string, rules: SegmentRules): Where {
  const parts = rules.rules.map(ruleWhere);
  const base: Where = { tenantId, deletedAt: null };
  if (parts.length === 0) return base;
  return { ...base, ...(rules.match === 'all' ? { AND: parts } : { OR: parts }) };
}

/**
 * Saved audiences. Membership is evaluated on demand, so it always reflects current data and consent.
 * Exports default to people who opted in; opted-out people are never exported for marketing.
 */
@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<SegmentRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.segment.findMany({ where: { tenantId: auth.tenantId }, orderBy: { name: 'asc' } });
      const names = await ownerRefs(tx, rows.map((r) => r.createdById));
      return rows.map((r) => toRow(r, names));
    });
  }

  save(auth: AuthContext, id: string | null, input: SegmentInput, meta: RequestMeta): Promise<SegmentRow> {
    return this.prisma.run(auth, async (tx) => {
      try {
        const data = { name: input.name, description: input.description ?? null, entity: input.entity, rules: input.rules as unknown as Prisma.InputJsonValue };
        const row = id
          ? await (async () => {
              const { count } = await tx.segment.updateMany({ where: { id, tenantId: auth.tenantId }, data });
              if (!count) throw notFound('Segment');
              return tx.segment.findFirstOrThrow({ where: { id } });
            })()
          : await tx.segment.create({ data: { ...data, tenantId: auth.tenantId, createdById: auth.userId } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'segment.updated' : 'segment.created', entityType: 'segment', entityId: row.id, metadata: { name: input.name }, meta });
        return toRow(row, await ownerRefs(tx, [row.createdById]));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException({ code: 'DUPLICATE', message: 'A segment with this name already exists.' });
        throw err;
      }
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.segment.deleteMany({ where: { id, tenantId: auth.tenantId } });
      if (!count) throw notFound('Segment');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'segment.deleted', entityType: 'segment', entityId: id, meta });
    });
  }

  /** Counts and a sample for unsaved rules (the builder) or a saved segment. */
  preview(auth: AuthContext, entity: SegmentEntity, rules: SegmentRules): Promise<SegmentPreview> {
    this.requireRead(auth, entity);
    return this.prisma.run(auth, async (tx) => {
      const where = segmentWhere(auth.tenantId, rules);
      const count = (extra: Where) => (entity === 'lead' ? tx.lead.count({ where: { AND: [where, extra] } as Prisma.LeadWhereInput }) : tx.contact.count({ where: { AND: [where, extra] } as Prisma.ContactWhereInput }));
      const [total, optedIn, optedOut] = await Promise.all([count({}), count({ marketingConsent: 'OPTED_IN' }), count({ marketingConsent: 'OPTED_OUT' })]);
      const sample = await this.members(tx, entity, where, 25);
      return { total, optedIn, optedOut, sample };
    });
  }

  async previewSaved(auth: AuthContext, id: string): Promise<SegmentPreview> {
    const s = await this.prisma.run(auth, (tx) => this.find(tx, auth.tenantId, id));
    return this.preview(auth, s.entity as SegmentEntity, s.rules as unknown as SegmentRules);
  }

  /** CSV of members. Opted-in only unless the caller asks for everyone (e.g. for a sales call list). */
  async exportCsv(auth: AuthContext, id: string, optedInOnly: boolean, meta: RequestMeta): Promise<{ filename: string; csv: string }> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.find(tx, auth.tenantId, id);
      const entity = s.entity as SegmentEntity;
      this.requireRead(auth, entity);
      const base = segmentWhere(auth.tenantId, s.rules as unknown as SegmentRules);
      const where = optedInOnly ? { AND: [base, { marketingConsent: 'OPTED_IN' }] } : { AND: [base, { NOT: { marketingConsent: 'OPTED_OUT' } }] };
      const rows = await this.members(tx, entity, where, 10_000);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'segment.exported', entityType: 'segment', entityId: id, metadata: { rows: rows.length, optedInOnly }, meta });
      const csv = toCsv(['name', 'email', 'marketing_consent'], rows.map((r) => [r.name, r.email ?? '', r.marketingConsent]));
      return { filename: `${s.name.replace(/[^\w-]+/g, '-').toLowerCase()}.csv`, csv };
    });
  }

  private async members(tx: TenantTx, entity: SegmentEntity, where: Where, take: number): Promise<SegmentPreview['sample']> {
    if (entity === 'lead') {
      const rows = await tx.lead.findMany({ where: where as Prisma.LeadWhereInput, select: { id: true, fullName: true, email: true, marketingConsent: true }, orderBy: { createdAt: 'desc' }, take });
      return rows.map((r) => ({ id: r.id, name: r.fullName, email: r.email, marketingConsent: r.marketingConsent }));
    }
    const rows = await tx.contact.findMany({ where: where as Prisma.ContactWhereInput, select: { id: true, firstName: true, lastName: true, email: true, marketingConsent: true }, orderBy: { createdAt: 'desc' }, take });
    return rows.map((r) => ({ id: r.id, name: [r.firstName, r.lastName].filter(Boolean).join(' '), email: r.email, marketingConsent: r.marketingConsent }));
  }

  private requireRead(auth: AuthContext, entity: SegmentEntity) {
    const p = entity === 'lead' ? 'leads:read' : 'contacts:read';
    if (!auth.permissions.includes(p)) throw new ForbiddenException({ code: 'FORBIDDEN', message: `Your role cannot read ${entity}s.` });
  }

  private async find(tx: TenantTx, tenantId: string, id: string) {
    const s = await tx.segment.findFirst({ where: { id, tenantId } });
    if (!s) throw notFound('Segment');
    return s;
  }
}

function toRow(r: { id: string; name: string; description: string | null; entity: string; rules: unknown; createdById: string | null; createdAt: Date; updatedAt: Date }, names: Map<string, { id: string; name: string }>): SegmentRow {
  return {
    id: r.id, name: r.name, description: r.description, entity: r.entity as SegmentEntity, rules: r.rules as SegmentRules,
    createdBy: r.createdById ? (names.get(r.createdById) ?? null) : null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}
