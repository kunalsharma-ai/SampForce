import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { Prisma, type TenantTx } from '@dealflow/database';
import { assignLeadNumbers } from '@dealflow/database';
import {
  allowsExport,
  companyInputSchema,
  contactInputSchema,
  customFieldText,
  type ExportFormat,
  type ImportEntity,
  type ImportRequest,
  type ImportResult,
  leadInputSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { featureNotIncluded, hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { localize, tr } from '../common/request-language';
import { ownerRefs } from './crm-helpers';
import { parseCsv, toCsv } from './csv';
import { CrmAdminService } from './crm-admin.service';
import { CustomFieldsService } from './custom-fields.service';
import { defaultStatusId, statusRefs } from './companies.service';
import { canSeeDetails, companyScope, contactScope, leadScope, visibility } from './visibility';
import { phoneDigits } from './leads.service';

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_EXPORT_ROWS = 50_000;
export const EXPORT_ENTITIES = ['leads', 'contacts', 'companies', 'deals', 'rfqs'] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

/** Built-in fields a CSV column can map to. Custom fields map as `customFields.<key>`. */
export const IMPORT_FIELDS: Record<ImportEntity, string[]> = {
  leads: ['fullName', 'companyName', 'jobTitle', 'industry', 'email', 'phone', 'country', 'city', 'timezone', 'website', 'source', 'campaignSource', 'estimatedValue', 'currency', 'status', 'tags'],
  contacts: ['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'country', 'timezone', 'companyName'],
  companies: ['name', 'domain', 'industry', 'country'],
};

const ENTITY_KEY = { leads: 'LEAD', contacts: 'CONTACT', companies: 'COMPANY' } as const;
const SCHEMAS = { leads: leadInputSchema, contacts: contactInputSchema, companies: companyInputSchema };

interface Prepared {
  row: number;
  data: Record<string, unknown>;
  companyName?: string | null;
  dupKeys: string[];
}

@Injectable()
export class ImportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
    private readonly admin: CrmAdminService,
  ) {}

  /**
   * Validates every row with the same schemas as the create endpoints, then inserts the valid,
   * non-duplicate rows in one transaction. A dry run performs every check and writes nothing.
   */
  async import(auth: AuthContext, req: ImportRequest, meta: RequestMeta): Promise<ImportResult> {
    const rows = parseCsv(req.csv);
    const header = rows.shift()?.map((h) => h.trim()) ?? [];
    if (header.length === 0) throw invalid('csv', 'The file has no header row.');
    if (rows.length > MAX_IMPORT_ROWS) throw invalid('csv', `Import at most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows at a time.`);

    const allowed = new Set(IMPORT_FIELDS[req.entity]);
    const columns: { index: number; target: string }[] = [];
    for (const [column, target] of Object.entries(req.mapping)) {
      if (!target) continue;
      const index = header.indexOf(column);
      if (index < 0) throw invalid(`mapping.${column}`, 'is not a column in the file');
      if (!allowed.has(target) && !/^customFields\.[a-z][a-z0-9_]{1,39}$/.test(target)) throw invalid(`mapping.${column}`, `cannot map to "${target}"`);
      columns.push({ index, target });
    }
    const required = { leads: 'fullName', contacts: 'firstName', companies: 'name' }[req.entity];
    if (!columns.some((c) => c.target === required)) throw invalid('mapping', `Map a column to ${required}.`);

    const result: ImportResult = { entity: req.entity, dryRun: req.dryRun, totalRows: rows.length, created: 0, skippedDuplicates: 0, errors: [] };

    return this.prisma.run(
      auth,
      async (tx) => {
        const defs = await this.fields.definitions(tx, auth.tenantId, ENTITY_KEY[req.entity]);
        const prepared: Prepared[] = [];
        for (const [i, cells] of rows.entries()) {
          const rowNumber = i + 2; // 1-based, after the header row
          const raw: Record<string, unknown> = {};
          const custom: Record<string, unknown> = {};
          for (const { index, target } of columns) {
            const value = (cells[index] ?? '').trim();
            if (target.startsWith('customFields.')) {
              if (value !== '') custom[target.slice(13)] = value;
            } else if (target === 'tags') raw.tags = value ? value.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [];
            else if (target === 'estimatedValue') raw.estimatedValue = value === '' ? null : value;
            else if (target === 'status') raw.status = value === '' ? undefined : value.toUpperCase();
            else if (target === 'currency') raw.currency = value === '' ? null : value;
            else raw[target] = value;
          }
          // Contacts link to a company by name; for leads companyName is a plain field.
          let companyName: string | null | undefined;
          if (req.entity === 'contacts') {
            companyName = (raw.companyName as string | undefined) || null;
            delete raw.companyName;
          }
          const parsed = SCHEMAS[req.entity].safeParse(raw);
          if (!parsed.success) {
            result.errors.push({ row: rowNumber, message: parsed.error.issues.map((e) => `${e.path.join('.') || 'row'}: ${localize(e.message)}`).join('; ') });
            continue;
          }
          let customFields: Record<string, unknown> | undefined;
          try {
            customFields = await this.fields.validate(tx, auth.tenantId, ENTITY_KEY[req.entity], custom, undefined, defs);
          } catch (err) {
            result.errors.push({ row: rowNumber, message: describeValidation(err) });
            continue;
          }
          const data = { ...(parsed.data as Record<string, unknown>), customFields: customFields ?? {} };
          prepared.push({ row: rowNumber, data, companyName, dupKeys: dupKeys(req.entity, data) });
        }

        const existing = await this.existingKeys(tx, auth.tenantId, req.entity, prepared.flatMap((p) => p.dupKeys));
        const toCreate: Prepared[] = [];
        for (const p of prepared) {
          const isDup = p.dupKeys.some((k) => existing.has(k));
          if (isDup && req.duplicateStrategy === 'skip') {
            result.skippedDuplicates++;
            continue;
          }
          p.dupKeys.forEach((k) => existing.add(k)); // later rows in the same file count as duplicates too
          toCreate.push(p);
        }
        result.created = toCreate.length;
        if (req.dryRun || toCreate.length === 0) return result;

        const base = { tenantId: auth.tenantId, ownerId: auth.userId, ...(req.entity === 'leads' ? {} : { createdById: auth.userId, updatedById: auth.userId, statusChangedAt: new Date() }) };
        const statusId = req.entity === 'leads' ? null : await defaultStatusId(tx, auth.tenantId, req.entity === 'companies' ? 'COMPANY' : 'EMPLOYEE');
        if (req.entity === 'leads') {
          await chunks(toCreate, (batch) =>
            tx.lead.createMany({ data: batch.map((p) => ({ ...base, ...(p.data as object), tags: (p.data.tags as string[]) ?? [] }) as Prisma.LeadCreateManyInput) }),
          );
        } else if (req.entity === 'companies') {
          await chunks(toCreate, (batch) => tx.company.createMany({ data: batch.map((p) => ({ ...base, statusId, ...(p.data as object) }) as Prisma.CompanyCreateManyInput) }));
          while ((await assignLeadNumbers(tx, auth.tenantId)) > 0);
        } else {
          const companyIds = await this.resolveCompanies(tx, auth, toCreate.map((p) => p.companyName).filter((n): n is string => !!n));
          await chunks(toCreate, (batch) =>
            tx.contact.createMany({
              data: batch.map((p) => ({ ...base, statusId, ...(p.data as object), companyId: p.companyName ? (companyIds.get(p.companyName.toLowerCase()) ?? null) : null }) as Prisma.ContactCreateManyInput),
            }),
          );
        }
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'data.imported', entityType: req.entity,
          metadata: { totalRows: result.totalRows, created: result.created, skippedDuplicates: result.skippedDuplicates, errors: result.errors.length },
          meta,
        });
        return result;
      },
      { timeoutMs: 60_000 },
    );
  }

  async export(auth: AuthContext, entity: ExportEntity, meta: RequestMeta, format: ExportFormat = 'csv'): Promise<{ data: string | Buffer; rows: number; contentType: string; extension: string }> {
    return this.prisma.run(
      auth,
      async (tx) => {
        // Export permissions (ADR 0062): the role's record types and formats, and Excel needs the plan feature.
        const policy = await this.admin.exportPolicyFor(tx, auth);
        if (!allowsExport(policy, entity, format)) {
          throw new ForbiddenException({ code: 'EXPORT_NOT_ALLOWED', message: 'Your role cannot export these records in this format.', details: [{ path: 'format', message: format }] });
        }
        if (format === 'xlsx' && !(await hasFeature(tx, auth.tenantId, 'excel_export'))) throw featureNotIncluded('excel_export');
        const noContact = policy?.withoutContactDetails === true;
        const cfEntity = ({ leads: 'LEAD', contacts: 'CONTACT', companies: 'COMPANY', deals: 'OPPORTUNITY', rfqs: 'RFQ' } as const)[entity];
        // Only fields the person may see are exported.
        const { defs: all } = await this.fields.accessFor(tx, auth, cfEntity);
        const defs = all.filter((d) => d.access.view);
        const cfHeaders = defs.map((d) => `customFields.${d.key}`);
        // Values of fields hidden by a failing condition are left out, as on the record page.
        const cf = (v: unknown) => {
          const shown = this.fields.visibleValues(all, v);
          return defs.map((d) => customFieldText(d.type, shown[d.key]) || null);
        };
        const where = { tenantId: auth.tenantId, deletedAt: null };
        // Exports follow record visibility; details of records the role may not see are left blank.
        const v = await visibility(tx, auth);
        const take = MAX_EXPORT_ROWS;
        const contact = <T>(value: T, show: boolean): T | null => (show && !noContact ? value : null);
        let headers: string[];
        let body: unknown[][];

        if (entity === 'leads') {
          const rows = await tx.lead.findMany({ where: { ...where, ...leadScope(v) }, orderBy: { createdAt: 'asc' }, take });
          const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
          headers = ['id', ...IMPORT_FIELDS.leads, 'owner', 'createdAt', ...cfHeaders];
          body = rows.map((r) => {
            const show = canSeeDetails(v, r.ownerId);
            return [
              r.id, r.fullName, r.companyName, r.jobTitle, r.industry, contact(r.email, show), contact(r.phone, show), r.country, r.city, r.timezone, r.website,
              r.source, r.campaignSource, r.estimatedValue?.toString(), r.currency, r.status, r.tags,
              r.ownerId ? owners.get(r.ownerId)?.name : null, r.createdAt, ...(show ? cf(r.customFields) : cf({})),
            ];
          });
        } else if (entity === 'contacts') {
          const rows = await tx.contact.findMany({ where: { ...where, ...contactScope(v) }, include: { company: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take });
          const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
          const statuses = await statusRefs(tx, auth.tenantId, rows.map((r) => r.statusId));
          headers = ['id', ...IMPORT_FIELDS.contacts, 'owner', 'createdAt', 'status', 'department', 'linkedinUrl', 'nextFollowUpAt', ...cfHeaders];
          body = rows.map((r) => {
            const show = canSeeDetails(v, r.ownerId);
            return [
              r.id, r.firstName, r.lastName, contact(r.email, show), contact(r.phone, show), r.jobTitle, r.country, r.timezone, r.company?.name,
              r.ownerId ? owners.get(r.ownerId)?.name : null, r.createdAt, r.statusId ? statuses.get(r.statusId)?.name : null, r.department,
              contact(r.linkedinUrl, show), r.nextFollowUpAt, ...(show ? cf(r.customFields) : cf({})),
            ];
          });
        } else if (entity === 'companies') {
          const rows = await tx.company.findMany({ where: { ...where, ...companyScope(v) }, orderBy: { createdAt: 'asc' }, take });
          const owners = await ownerRefs(tx, rows.flatMap((r) => [r.ownerId, r.createdById, r.managerId]));
          const statuses = await statusRefs(tx, auth.tenantId, rows.map((r) => r.statusId));
          const name = (id: string | null) => (id ? owners.get(id)?.name : null);
          headers = ['id', ...IMPORT_FIELDS.companies, 'owner', 'createdAt', 'leadNumber', 'status', 'createdBy', 'manager', 'website', 'linkedinUrl', 'primaryEmail', 'primaryPhone', 'state', 'city', 'companySize', 'companyType', ...cfHeaders];
          body = rows.map((r) => {
            const show = canSeeDetails(v, r.ownerId);
            return [
              r.id, r.name, show ? r.domain : null, r.industry, r.country, name(r.ownerId), r.createdAt, r.leadNumber, r.statusId ? statuses.get(r.statusId)?.name : null,
              name(r.createdById), name(r.managerId), show ? r.website : null, contact(r.linkedinUrl, show), contact(r.primaryEmail, show), contact(r.primaryPhone, show),
              r.state, r.city, r.companySize, r.companyType, ...(show ? cf(r.customFields) : cf({})),
            ];
          });
        } else if (entity === 'rfqs') {
          const companies = v.all ? null : (await tx.company.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true } })).map((c) => c.id);
          const rows = await tx.rfq.findMany({ where: { ...where, ...(companies ? { companyId: { in: companies } } : {}) }, include: { company: { select: { name: true, leadNumber: true, ownerId: true } } }, orderBy: { seq: 'asc' }, take });
          const owners = await ownerRefs(tx, rows.flatMap((r) => [r.ownerId, r.managerId]));
          const name = (id: string | null) => (id ? owners.get(id)?.name : null);
          headers = ['id', 'number', 'company', 'leadNumber', 'projectName', 'methodology', 'market', 'industry', 'targetAudience', 'sampleSize', 'loi', 'ir', 'cpi', 'totalQuotation', 'currency', 'status', 'receivedAt', 'submittedAt', 'deadlineAt', 'owner', 'manager', 'expectedRevenue', 'actualRevenue', 'outcomeReason', ...cfHeaders];
          body = rows.map((r) => [
            r.id, r.number, r.company.name, r.company.leadNumber, r.projectName, r.methodology, r.market, r.industry, r.targetAudience, r.sampleSize, r.loi, r.ir, r.cpi,
            r.totalQuotation, r.currency, r.status, r.receivedAt, r.submittedAt, r.deadlineAt, name(r.ownerId), name(r.managerId), r.expectedRevenue, r.actualRevenue, r.outcomeReason,
            ...(canSeeDetails(v, r.company.ownerId) ? cf(r.customFields) : cf({})),
          ]);
        } else {
          const rows = await tx.opportunity.findMany({
            where,
            include: { pipeline: { select: { name: true } }, stage: { select: { name: true } }, company: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
            take,
          });
          const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
          headers = ['id', 'name', 'amount', 'currency', 'status', 'pipeline', 'stage', 'company', 'expectedCloseDate', 'closedAt', 'lossReason', 'owner', 'createdAt', ...cfHeaders];
          body = rows.map((r) => [
            r.id, r.name, r.amount.toString(), r.currency, r.status, r.pipeline.name, r.stage.name, r.company?.name,
            r.expectedCloseDate?.toISOString().slice(0, 10), r.closedAt, r.lossReason, r.ownerId ? owners.get(r.ownerId)?.name : null,
            r.createdAt, ...cf(r.customFields),
          ]);
        }
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'data.exported', entityType: entity,
          metadata: { rows: body.length, truncated: body.length >= take, format }, meta,
        });
        if (format === 'xlsx') {
          const labels = new Map(defs.map((d) => [`customFields.${d.key}`, d.label]));
          return { data: await toXlsx(entity, headers.map((h) => labels.get(h) ?? h), body), rows: body.length, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
        }
        return { data: toCsv(headers, body), rows: body.length, contentType: 'text/csv; charset=utf-8', extension: 'csv' };
      },
      { timeoutMs: 60_000 },
    );
  }

  private async existingKeys(tx: TenantTx, tenantId: string, entity: ImportEntity, keys: string[]): Promise<Set<string>> {
    const emails = keys.filter((k) => k.startsWith('email:')).map((k) => k.slice(6));
    const phones = keys.filter((k) => k.startsWith('phone:')).map((k) => k.slice(6));
    const names = keys.filter((k) => k.startsWith('name:')).map((k) => k.slice(5));
    const domains = keys.filter((k) => k.startsWith('domain:')).map((k) => k.slice(7));
    const found = new Set<string>();
    // Case-insensitive matches; values are escaped by the database client. Batches keep each filter small.
    const chunks = <T>(xs: T[], n = 200): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
    const people = entity === 'leads' ? tx.lead : entity === 'contacts' ? tx.contact : null;
    const findPeople = (where: Prisma.LeadWhereInput & Prisma.ContactWhereInput) =>
      entity === 'leads'
        ? tx.lead.findMany({ where: { tenantId, deletedAt: null, ...where }, select: { email: true, phoneDigits: true } })
        : tx.contact.findMany({ where: { tenantId, deletedAt: null, ...where }, select: { email: true, phoneDigits: true } });
    if (emails.length && people) {
      for (const part of chunks(emails)) {
        const rows = await findPeople({ email: { in: part, mode: 'insensitive' } });
        rows.forEach((r) => r.email && found.add(`email:${r.email.toLowerCase()}`));
      }
    }
    if (phones.length && people) {
      for (const part of chunks(phones)) {
        const rows = await findPeople({ phoneDigits: { in: part } });
        rows.forEach((r) => r.phoneDigits && found.add(`phone:${r.phoneDigits}`));
      }
    }
    if (entity === 'companies') {
      for (const part of chunks(names)) {
        const rows = await tx.company.findMany({ where: { tenantId, deletedAt: null, name: { in: part, mode: 'insensitive' } }, select: { name: true } });
        rows.forEach((r) => found.add(`name:${r.name.toLowerCase()}`));
      }
      for (const part of chunks(domains)) {
        const rows = await tx.company.findMany({ where: { tenantId, deletedAt: null, domain: { in: part, mode: 'insensitive' } }, select: { domain: true } });
        rows.forEach((r) => r.domain && found.add(`domain:${r.domain.toLowerCase()}`));
      }
    }
    return found;
  }

  /** Matches company names case-insensitively, creating the ones that do not exist yet. */
  private async resolveCompanies(tx: TenantTx, auth: AuthContext, names: string[]): Promise<Map<string, string>> {
    const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).entries()];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    // The oldest company wins when several share a name.
    const rows = await tx.company.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null, name: { in: unique.map(([k]) => k), mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    rows.forEach((r) => map.has(r.name.toLowerCase()) || map.set(r.name.toLowerCase(), r.id));
    for (const [key, name] of unique) {
      if (map.has(key)) continue;
      const c = await tx.company.create({
        data: { tenantId: auth.tenantId, ownerId: auth.userId, createdById: auth.userId, updatedById: auth.userId, name: name.slice(0, 200), statusId: await defaultStatusId(tx, auth.tenantId, 'COMPANY'), statusChangedAt: new Date() },
        select: { id: true },
      });
      map.set(key, c.id);
    }
    while ((await assignLeadNumbers(tx, auth.tenantId)) > 0);
    return map;
  }
}

function dupKeys(entity: ImportEntity, data: Record<string, unknown>): string[] {
  const keys: string[] = [];
  if (entity === 'companies') {
    if (typeof data.name === 'string') keys.push(`name:${data.name.toLowerCase()}`);
    if (typeof data.domain === 'string') keys.push(`domain:${data.domain.toLowerCase()}`);
    return keys;
  }
  if (typeof data.email === 'string') keys.push(`email:${data.email.toLowerCase()}`);
  const digits = phoneDigits(data.phone as string | null);
  if (digits) keys.push(`phone:${digits}`);
  return keys;
}

async function chunks<T>(items: T[], fn: (batch: T[]) => Promise<unknown>, size = 500): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

function invalid(path: string, message: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', message, details: [{ path, message }] });
}

function describeValidation(err: unknown): string {
  if (err instanceof BadRequestException) {
    const body = err.getResponse() as { details?: { path: string; message: string }[]; message?: string };
    return body.details?.map((d) => `${d.path}: ${localize(d.message)}`).join('; ') ?? (body.message ? localize(body.message) : tr('Invalid row'));
  }
  throw err;
}

/**
 * An Excel workbook of the same rows as the CSV: one sheet, a bold frozen header, dates as dates. Cells that start
 * with =, +, - or @ are written as text, so a spreadsheet never runs them as formulas.
 */
export async function toXlsx(sheet: string, headers: string[], rows: unknown[][]): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'SampForce';
  const ws = wb.addWorksheet(sheet.slice(0, 31));
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    ws.addRow(
      r.map((c) => {
        if (c === null || c === undefined) return null;
        if (c instanceof Date) return c;
        if (Array.isArray(c)) return c.join(', ');
        if (typeof c === 'number' || typeof c === 'boolean') return c;
        const t = String(c);
        return /^[=+\-@]/.test(t) ? `'${t}` : t;
      }),
    );
  }
  headers.forEach((h, i) => (ws.getColumn(i + 1).width = Math.min(40, Math.max(10, h.length + 2))));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
