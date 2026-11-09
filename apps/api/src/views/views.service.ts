import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type BulkActionInput,
  type BulkActionResult,
  LEAD_STATUSES,
  MAX_SAVED_VIEWS,
  type SavedView,
  type SavedViewInput,
  type SavedViewUpdate,
  type TableEntity,
  viewConfigSchema,
} from '@dealflow/types';
import { Prisma } from '@dealflow/database';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { CompaniesService } from '../crm/companies.service';
import { ContactsService } from '../crm/contacts.service';
import { DealsService } from '../crm/deals.service';
import { LeadsService } from '../crm/leads.service';

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
    const result: BulkActionResult = { updated: 0, failed: [] };
    for (const id of [...new Set(input.ids)]) {
      try {
        if (input.action === 'delete') await svc.remove(auth, id, meta);
        else if (input.action === 'assign') await (svc.update as (a: AuthContext, i: string, b: object, m: RequestMeta) => Promise<unknown>)(auth, id, { ownerId: input.ownerId }, meta);
        else await this.leads.update(auth, id, { status: input.status as Exclude<(typeof LEAD_STATUSES)[number], 'CONVERTED'> }, meta);
        result.updated += 1;
      } catch (e) {
        const body = (e as { getResponse?: () => unknown }).getResponse?.() as { message?: string } | undefined;
        result.failed.push({ id, message: body?.message ?? 'Could not update this record.' });
      }
    }
    return result;
  }
}
