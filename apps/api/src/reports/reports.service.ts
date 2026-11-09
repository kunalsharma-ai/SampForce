import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { aggregate, type Prisma, type TenantTx } from '@dealflow/database';
import {
  type DashboardInput,
  type DashboardRow,
  type Permission,
  REPORT_CATALOG,
  type ReportDefinition,
  reportDefinitionSchema,
  reportField,
  type ReportInput,
  type ReportResult,
  type ReportRow,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { toCsv } from '../crm/csv';
import { labelRows } from './report-labels';
import { ENTITY_SPECS, groupedPipeline, isMoney, type QueryContext, totalsPipeline } from './report-pipeline';
import { loadRates } from '../revenue/fx';

/** Reports read many rows; a runaway definition must not hold a connection. */
const STATEMENT_TIMEOUT_MS = 10_000;

function forbid(permission: string): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.', details: [{ path: 'permission', message: permission }] });
}

function can(auth: AuthContext, p: Permission): boolean {
  return auth.permissions.includes(p);
}

type ReportRecord = { id: string; name: string; description: string | null; visibility: 'PRIVATE' | 'WORKSPACE'; definition: Prisma.JsonValue; createdById: string | null; createdAt: Date; updatedAt: Date };
type DashboardRecord = Omit<ReportRecord, 'definition'> & { widgets: Prisma.JsonValue };

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Records the viewer may see: their own, and everything shared with the workspace. */
  private visible(auth: AuthContext) {
    return { tenantId: auth.tenantId, OR: [{ visibility: 'WORKSPACE' as const }, { createdById: auth.userId }] };
  }

  private editable(auth: AuthContext, r: { createdById: string | null; visibility: string }): boolean {
    if (r.createdById === auth.userId) return can(auth, 'reports:write');
    return r.visibility === 'WORKSPACE' && can(auth, 'reports:manage');
  }

  private assertEditable(auth: AuthContext, r: { createdById: string | null; visibility: string }) {
    if (!this.editable(auth, r)) throw forbid(r.createdById === auth.userId ? 'reports:write' : 'reports:manage');
  }

  /** A stored definition is re-validated on read so a catalogue change can never feed an unknown field to SQL. */
  private parse(def: Prisma.JsonValue): ReportDefinition | null {
    const parsed = reportDefinitionSchema.safeParse(def);
    return parsed.success ? parsed.data : null;
  }

  private async toRows(tx: TenantTx, auth: AuthContext, rows: ReportRecord[]): Promise<ReportRow[]> {
    const users = await ownerRefs(tx, rows.map((r) => r.createdById));
    return rows.flatMap((r) => {
      const definition = this.parse(r.definition);
      if (!definition) return [];
      return [{
        id: r.id, name: r.name, description: r.description, visibility: r.visibility, definition,
        createdBy: r.createdById ? (users.get(r.createdById) ?? null) : null, editable: this.editable(auth, r),
        createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      }];
    });
  }

  list(auth: AuthContext): Promise<ReportRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.report.findMany({ where: this.visible(auth), orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 500 });
      return this.toRows(tx, auth, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<ReportRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.report.findFirst({ where: { id, ...this.visible(auth) } });
      if (!row) throw notFound('Report');
      const [out] = await this.toRows(tx, auth, [row]);
      if (!out) throw notFound('Report');
      return out;
    });
  }

  create(auth: AuthContext, input: ReportInput, meta: RequestMeta): Promise<ReportRow> {
    this.assertEntity(auth, input.definition);
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.report.create({
        data: {
          tenantId: auth.tenantId, name: input.name, description: input.description ?? null, visibility: input.visibility,
          definition: input.definition as unknown as Prisma.InputJsonValue, createdById: auth.userId,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'report.created', entityType: 'report', entityId: row.id, metadata: { name: row.name, entity: input.definition.entity, visibility: row.visibility }, meta });
      return (await this.toRows(tx, auth, [row]))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: ReportInput, meta: RequestMeta): Promise<ReportRow> {
    this.assertEntity(auth, input.definition);
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.report.findFirst({ where: { id, ...this.visible(auth) } });
      if (!before) throw notFound('Report');
      this.assertEditable(auth, before);
      if (before.createdById !== auth.userId && input.visibility === 'PRIVATE') {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Only the author can make a shared report private.', details: [{ path: 'visibility', message: 'only the author can change this' }] });
      }
      const row = await tx.report.update({
        where: { id },
        data: { name: input.name, description: input.description ?? null, visibility: input.visibility, definition: input.definition as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'report.updated', entityType: 'report', entityId: id, metadata: { name: row.name, visibility: row.visibility }, meta });
      return (await this.toRows(tx, auth, [row]))[0]!;
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.report.findFirst({ where: { id, ...this.visible(auth) } });
      if (!before) throw notFound('Report');
      this.assertEditable(auth, before);
      await tx.report.delete({ where: { id } });
      // Drop the report from every dashboard in the workspace, including private ones it was pinned to.
      const boards = await tx.dashboard.findMany({ where: { tenantId: auth.tenantId }, select: { id: true, widgets: true } });
      for (const b of boards) {
        const widgets = (Array.isArray(b.widgets) ? b.widgets : []) as { reportId?: string }[];
        if (widgets.some((w) => w.reportId === id)) {
          await tx.dashboard.update({ where: { id: b.id }, data: { widgets: widgets.filter((w) => w.reportId !== id) as Prisma.InputJsonValue } });
        }
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'report.deleted', entityType: 'report', entityId: id, metadata: { name: before.name }, meta });
    });
  }

  /** Running a report needs read access to its records, on top of reports:read. */
  private assertEntity(auth: AuthContext, def: ReportDefinition) {
    const p = REPORT_CATALOG[def.entity].permission;
    if (!can(auth, p)) throw forbid(p);
  }

  run(auth: AuthContext, def: ReportDefinition): Promise<ReportResult> {
    this.assertEntity(auth, def);
    return this.prisma.run(auth, (tx) => this.execute(tx, auth, def), { timeoutMs: STATEMENT_TIMEOUT_MS + 5_000 });
  }

  async runSaved(auth: AuthContext, id: string): Promise<ReportResult> {
    const report = await this.get(auth, id);
    return this.run(auth, report.definition);
  }

  private async execute(tx: TenantTx, auth: AuthContext, def: ReportDefinition): Promise<ReportResult> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true, defaultTimezone: true } });
    const ctx: QueryContext = { tenantId: auth.tenantId, baseCurrency: tenant.defaultCurrency, timezone: tenant.defaultTimezone || 'UTC', rates: await loadRates(tx, auth.tenantId) };
    const delegate = tx[ENTITY_SPECS[def.entity].model] as unknown as { aggregateRaw(args: { pipeline: object[]; options?: object }): unknown };
    const limited = { aggregateRaw: (args: { pipeline: object[] }) => delegate.aggregateRaw({ ...args, options: { maxTimeMS: STATEMENT_TIMEOUT_MS } }) };
    const grouped = (await aggregate<{ _id: string | null; v: number | null }>(limited, groupedPipeline(def, ctx))).map((r) => ({ g: r._id, v: r.v }));
    const [totals] = await aggregate<{ v: number | null; n: number; ex: number; excur: Array<string | null> }>(limited, totalsPipeline(def, ctx));
    const truncated = grouped.length > def.limit;
    const shown = grouped.slice(0, def.limit);
    const field = def.groupBy ? reportField(def.entity, def.groupBy.field) : undefined;
    const users = field?.kind === 'user' ? await ownerRefs(tx, shown.map((r) => r.g)) : new Map();
    const money = isMoney(def);
    const metricField = def.metric.field ? reportField(def.entity, def.metric.field) : undefined;
    const noun = REPORT_CATALOG[def.entity].label.toLowerCase().replace(/ \(.*\)$/, '');
    const metricLabel = def.metric.fn === 'count' ? `Number of ${noun}` : `${{ sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest' }[def.metric.fn]} ${metricField?.label.toLowerCase() ?? ''}`.trim();
    let groupLabel: string | null = field?.label ?? null;
    if (groupLabel && def.groupBy?.bucket) groupLabel = `${groupLabel} (${def.groupBy.bucket})`;
    return {
      entity: def.entity,
      metricLabel,
      groupLabel,
      rows: def.groupBy ? labelRows(def, shown, users) : [{ key: null, label: 'All', value: Math.round((totals?.v ?? 0) * 100) / 100 }],
      total: Math.round((totals?.v ?? 0) * 100) / 100,
      records: totals?.n ?? 0,
      currency: money ? ctx.baseCurrency : null,
      excluded: money && totals && totals.ex > 0 ? { records: totals.ex, currencies: totals.excur.filter((c): c is string => !!c).sort() } : null,
      truncated,
      generatedAt: new Date().toISOString(),
    };
  }

  /** CSV of a saved report's result. Bulk egress: needs data:export and is audited. */
  async exportCsv(auth: AuthContext, id: string, meta: RequestMeta): Promise<{ csv: string; name: string }> {
    if (!can(auth, 'data:export')) throw forbid('data:export');
    const report = await this.get(auth, id);
    const result = await this.run(auth, report.definition);
    const headers = [result.groupLabel ?? 'Group', result.currency ? `${result.metricLabel} (${result.currency})` : result.metricLabel];
    const rows: unknown[][] = result.rows.map((r) => [r.label, r.value]);
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'report.exported', entityType: 'report', entityId: id, metadata: { name: report.name, rows: rows.length }, meta }),
    );
    return { csv: toCsv(headers, rows), name: report.name };
  }

  // ───────────── Dashboards ─────────────

  private async toBoards(tx: TenantTx, auth: AuthContext, rows: DashboardRecord[]): Promise<DashboardRow[]> {
    const users = await ownerRefs(tx, rows.map((r) => r.createdById));
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, visibility: r.visibility,
      widgets: (Array.isArray(r.widgets) ? r.widgets : []) as DashboardRow['widgets'],
      createdBy: r.createdById ? (users.get(r.createdById) ?? null) : null, editable: this.editable(auth, r),
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    }));
  }

  listDashboards(auth: AuthContext): Promise<DashboardRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.dashboard.findMany({ where: this.visible(auth), orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 200 });
      return this.toBoards(tx, auth, rows);
    });
  }

  getDashboard(auth: AuthContext, id: string): Promise<DashboardRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.dashboard.findFirst({ where: { id, ...this.visible(auth) } });
      if (!row) throw notFound('Dashboard');
      return (await this.toBoards(tx, auth, [row]))[0]!;
    });
  }

  /** Widgets may only point at reports the author can see; a shared dashboard may only hold shared reports. */
  private async assertWidgets(tx: TenantTx, auth: AuthContext, input: DashboardInput) {
    if (input.widgets.length === 0) return;
    const ids = input.widgets.map((w) => w.reportId);
    const found = await tx.report.findMany({ where: { id: { in: ids }, ...this.visible(auth) }, select: { id: true, visibility: true } });
    if (found.length !== ids.length) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'widgets', message: 'contains reports that do not exist' }] });
    }
    if (input.visibility === 'WORKSPACE' && found.some((r) => r.visibility === 'PRIVATE')) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A shared dashboard can only hold shared reports. Share the reports first.', details: [{ path: 'widgets', message: 'contains private reports' }] });
    }
  }

  createDashboard(auth: AuthContext, input: DashboardInput, meta: RequestMeta): Promise<DashboardRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.assertWidgets(tx, auth, input);
      const row = await tx.dashboard.create({
        data: { tenantId: auth.tenantId, name: input.name, description: input.description ?? null, visibility: input.visibility, widgets: input.widgets as Prisma.InputJsonValue, createdById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dashboard.created', entityType: 'dashboard', entityId: row.id, metadata: { name: row.name, visibility: row.visibility }, meta });
      return (await this.toBoards(tx, auth, [row]))[0]!;
    });
  }

  updateDashboard(auth: AuthContext, id: string, input: DashboardInput, meta: RequestMeta): Promise<DashboardRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.dashboard.findFirst({ where: { id, ...this.visible(auth) } });
      if (!before) throw notFound('Dashboard');
      this.assertEditable(auth, before);
      if (before.createdById !== auth.userId && input.visibility === 'PRIVATE') {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Only the author can make a shared dashboard private.', details: [{ path: 'visibility', message: 'only the author can change this' }] });
      }
      await this.assertWidgets(tx, auth, input);
      const row = await tx.dashboard.update({
        where: { id },
        data: { name: input.name, description: input.description ?? null, visibility: input.visibility, widgets: input.widgets as Prisma.InputJsonValue },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dashboard.updated', entityType: 'dashboard', entityId: id, metadata: { name: row.name, widgets: input.widgets.length }, meta });
      return (await this.toBoards(tx, auth, [row]))[0]!;
    });
  }

  removeDashboard(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.dashboard.findFirst({ where: { id, ...this.visible(auth) } });
      if (!before) throw notFound('Dashboard');
      this.assertEditable(auth, before);
      await tx.dashboard.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'dashboard.deleted', entityType: 'dashboard', entityId: id, metadata: { name: before.name }, meta });
    });
  }
}
