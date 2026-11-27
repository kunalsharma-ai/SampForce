import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type BulkActionInput,
  type BulkActionResult,
  LEAD_STATUSES,
  MAX_SAVED_VIEWS,
  type SavedView,
  type SavedViewInput,
  type SavedViewUpdate,
  listQuerySchema,
  type TableEntity,
  viewConfigSchema,
  z,
} from '@dealflow/types';
import { Prisma } from '@dealflow/database';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { CompaniesService } from '../crm/companies.service';
import { ContactsService } from '../crm/contacts.service';
import { DealsService } from '../crm/deals.service';
import { LeadsService } from '../crm/leads.service';
import { companyFiltersSchema, contactFiltersSchema } from '../crm/records.controller';
import { AuditService } from '../audit/audit.service';

type Row = Prisma.SavedViewGetPayload<{ include: { user: { select: { name: true } } } }>;

function toView(r: Row, userId: string): SavedView | null {
  // Stored config is re-validated so a view saved by an older version can never break the table.
  const config = viewConfigSchema.safeParse(r.config);
  if (!config.success) return null;
  return {
    id: r.id,
    entity: r.entity as TableEntity,
    name: r.name,
    shared: r.shared,
    mine: r.userId === userId,
    ownerName: r.user?.name ?? null,
    config: config.data,
    updatedAt: r.updatedAt.toISOString(),
  };
}

const nameTaken = () => new ConflictException({ code: 'NAME_TAKEN', message: 'You already have a view with this name.' });
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Saved table views (ADR 0042). The workspace guard returns the person's own views and views shared in the workspace; only the
 * creator can change or delete one, which the database client enforces as well.
 */
@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: AuthContext, entity: TableEntity): Promise<SavedView[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.savedView.findMany({
        where: { tenantId: auth.tenantId, entity },
        include: { user: { select: { name: true } } },
        orderBy: [{ shared: 'asc' }, { name: 'asc' }],
      });
      return rows.flatMap((r) => toView(r, auth.userId) ?? []);
    });
  }

  create(auth: AuthContext, input: SavedViewInput): Promise<SavedView> {
    return this.prisma
      .run(auth, async (tx) => {
        const count = await tx.savedView.count({ where: { tenantId: auth.tenantId, userId: auth.userId, entity: input.entity } });
        if (count >= MAX_SAVED_VIEWS) {
          throw new ConflictException({ code: 'LIMIT_REACHED', message: `You can keep up to ${MAX_SAVED_VIEWS} views per list. Delete one first.` });
        }
        const row = await tx.savedView.create({
          data: { tenantId: auth.tenantId, userId: auth.userId, entity: input.entity, name: input.name, shared: input.shared, config: input.config as Prisma.InputJsonValue },
          include: { user: { select: { name: true } } },
        });
        return toView(row, auth.userId)!;
      })
      .catch((e) => {
        throw isUnique(e) ? nameTaken() : e;
      });
  }

  update(auth: AuthContext, id: string, input: SavedViewUpdate): Promise<SavedView> {
    return this.prisma
      .run(auth, async (tx) => {
        const existing = await tx.savedView.findFirst({ where: { id, tenantId: auth.tenantId } });
        if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'View not found.' });
        if (existing.userId !== auth.userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the person who created a view can change it.' });
        const row = await tx.savedView.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.shared !== undefined ? { shared: input.shared } : {}),
            ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
          },
          include: { user: { select: { name: true } } },
        });
        return toView(row, auth.userId)!;
      })
      .catch((e) => {
        throw isUnique(e) ? nameTaken() : e;
      });
  }

  remove(auth: AuthContext, id: string): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const existing = await tx.savedView.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'View not found.' });
      if (existing.userId !== auth.userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the person who created a view can delete it.' });
      await tx.savedView.delete({ where: { id } });
    });
  }
}

/** How many records a bulk action changes at the same time. */
const BULK_CONCURRENCY = 8;
const BULK_STATUSES: Partial<Record<TableEntity, readonly string[]>> = {
  leads: LEAD_STATUSES.filter((s) => s !== 'CONVERTED'),
};

/**
 * Bulk actions on selected rows. Each record goes through the same service method as a single edit, so validation,
 * ownership checks, automation events and the audit trail are identical; a record that fails is reported, not hidden.
 */
@Injectable()
export class BulkActionsService {
  constructor(
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly deals: DealsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(auth: AuthContext, input: BulkActionInput, meta: RequestMeta): Promise<BulkActionResult> {
    if (!auth.permissions.includes(`${input.entity}:write`)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to change these records.' });
    }
    if (input.action === 'status') {
      const allowed = BULK_STATUSES[input.entity];
      if (!allowed) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'These records have no status to change.', details: [{ path: 'action', message: 'not supported for this list' }] });
      if (!allowed.includes(input.status!)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'status', message: 'is not a status you can set' }] });
    }
    const svc = { leads: this.leads, contacts: this.contacts, companies: this.companies, deals: this.deals }[input.entity];
    let ids = [...new Set(input.ids ?? [])];
    if (input.all) {
      // Every record the list shows for this query, on every page: found first, then changed, so the pages do not
      // shift under the loop. If the list no longer matches what the person saw, nothing is changed.
      ids = await this.matchingIds(auth, input.entity, input.all.query);
      if (ids.length !== input.all.expected) {
        throw new ConflictException({
          code: 'SELECTION_CHANGED',
          message: `The list changed: it now has ${ids.length.toLocaleString('en-US')} records, not ${input.all.expected.toLocaleString('en-US')}. Check it and try again.`,
          details: [{ path: 'all.expected', message: String(ids.length) }],
        });
      }
    }
    const result: BulkActionResult = { updated: 0, failed: [] };
    const one = async (id: string) => {
      try {
        if (input.action === 'delete') await svc.remove(auth, id, meta);
        else if (input.action === 'assign') await (svc.update as (a: AuthContext, i: string, b: object, m: RequestMeta) => Promise<unknown>)(auth, id, { ownerId: input.ownerId }, meta);
        else await this.leads.update(auth, id, { status: input.status as Exclude<(typeof LEAD_STATUSES)[number], 'CONVERTED'> }, meta);
        result.updated += 1;
      } catch (e) {
        const body = (e as { getResponse?: () => unknown }).getResponse?.() as { message?: string } | undefined;
        result.failed.push({ id, message: body?.message ?? 'Could not update this record.' });
      }
    };
    // Each record still goes through its own rules and audit entry; a few at a time keeps thousands quick.
    for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) await Promise.all(ids.slice(i, i + BULK_CONCURRENCY).map(one));
    if (input.all) {
      await this.prisma.run(auth, (tx) =>
        this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: `records.bulk_${input.action}`, entityType: input.entity,
          metadata: { matched: ids.length, updated: result.updated, failed: result.failed.length, query: input.all!.query }, meta,
        }),
      );
    }
    return result;
  }

  /** The ids of every record the list shows for this query (all pages), in list order. */
  private async matchingIds(auth: AuthContext, entity: TableEntity, raw: Record<string, string>): Promise<string[]> {
    const parsed = listQuerySchema.safeParse({ ...raw, page: 1, pageSize: 100 });
    const filters = (entity === 'companies' ? companyFiltersSchema : entity === 'contacts' ? contactFiltersSchema : z.object({})).safeParse(raw);
    if (!parsed.success || !filters.success) {
      const issues = [...(parsed.success ? [] : parsed.error.issues), ...(filters.success ? [] : filters.error.issues)];
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: issues.map((i) => ({ path: `all.query.${i.path.join('.')}`, message: i.message })) });
    }
    const q = parsed.data;
    const f = filters.data as Record<string, string | undefined>;
    const page = (n: number): Promise<{ items: { id: string }[] }> => {
      const pq = { ...q, page: n };
      if (entity === 'companies') return this.companies.list(auth, pq, { ...f, cf: q.cf });
      if (entity === 'contacts') return this.contacts.list(auth, pq, { statusId: f.statusId, cf: q.cf });
      if (entity === 'leads') return this.leads.list(auth, pq, q.cf);
      return this.deals.list(auth, pq, q.cf);
    };
    const ids: string[] = [];
    for (let n = 1; ; n++) {
      const { items } = await page(n);
      ids.push(...items.map((r) => r.id));
      if (items.length < q.pageSize) break;
    }
    return [...new Set(ids)];
  }
}
