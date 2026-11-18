import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { type CellValue, Workbook } from 'exceljs';
import { allowsExport, customFieldText, type ExportFormat, type ImportFileResult } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { featureNotIncluded, hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ownerRefs } from './crm-helpers';
import { toCsv } from './csv';
import { CrmAdminService } from './crm-admin.service';
import { CustomFieldsService } from './custom-fields.service';
import { statusRefs } from './companies.service';
import { assertSafeZip, UnsafeZipError } from '../prospects/zip-guard';
import { canSeeDetails, companyScope, contactScope, leadScope, visibility } from './visibility';

export const MAX_EXPORT_ROWS = 50_000;
export const EXPORT_ENTITIES = ['leads', 'contacts', 'companies', 'deals', 'rfqs'] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

/** The first columns of each export, in the order the rows below write them. */
const EXPORT_FIELDS = {
  leads: ['fullName', 'companyName', 'jobTitle', 'industry', 'email', 'phone', 'country', 'city', 'timezone', 'website', 'source', 'campaignSource', 'estimatedValue', 'currency', 'status', 'tags'],
  contacts: ['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'country', 'timezone', 'companyName'],
  companies: ['name', 'domain', 'industry', 'country'],
};

@Injectable()
export class ImportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
    private readonly admin: CrmAdminService,
  ) {}

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
          headers = ['id', ...EXPORT_FIELDS.leads, 'owner', 'createdAt', ...cfHeaders];
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
          headers = ['id', ...EXPORT_FIELDS.contacts, 'owner', 'createdAt', 'status', 'department', 'linkedinUrl', 'nextFollowUpAt', ...cfHeaders];
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
          headers = ['id', ...EXPORT_FIELDS.companies, 'owner', 'createdAt', 'leadNumber', 'status', 'createdBy', 'manager', 'website', 'linkedinUrl', 'primaryEmail', 'primaryPhone', 'state', 'city', 'companySize', 'companyType', ...cfHeaders];
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

/** The most rows an Excel file may hold for an import (the CSV limit, plus the header row). */
const MAX_SHEET_ROWS = 5_001;

/**
 * Reads the first worksheet with data of an .xlsx file into CSV, so it imports exactly like a CSV file. Dates become
 * YYYY-MM-DD, formulas their last calculated value, links their text, and rich text its plain text.
 */
export async function xlsxToCsv(data: Buffer): Promise<ImportFileResult> {
  try {
    assertSafeZip(data);
  } catch (e) {
    if (e instanceof UnsafeZipError) throw new BadRequestException({ code: 'INVALID_FILE', message: `That spreadsheet could not be read safely (${e.message}). Save it again as .xlsx or export it as CSV.` });
    throw e;
  }
  const wb = new Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This file is not an Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.', details: [{ path: 'data', message: 'This file is not an Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.' }] });
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The workbook has no rows.', details: [{ path: 'data', message: 'The workbook has no rows.' }] });
  if (ws.actualRowCount > MAX_SHEET_ROWS) {
    const message = `Import at most ${(MAX_SHEET_ROWS - 1).toLocaleString('en-US')} rows at a time.`;
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message, details: [{ path: 'data', message }] });
  }
  const rows: string[][] = [];
  let width = 0;
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value);
    });
    rows[n - 1] = Array.from(cells, (c) => c ?? '');
    width = Math.max(width, cells.length);
  });
  // Spreadsheets often carry blank rows at the top; the first row with text is the header.
  const dense = Array.from(rows, (r) => r ?? []);
  const first = dense.findIndex((r) => r.some((c) => c.trim() !== ''));
  const body = dense.slice(first).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  return { csv: toCsv(body[0] ?? [], body.slice(1), false), sheet: ws.name, rows: Math.max(0, body.length - 1) };
}

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Excel stores dates without a zone; exceljs reads them as UTC. A time of day only when there is one.
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  }
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('text' in v && v.text && typeof v.text === 'object' && 'richText' in v.text) return (v.text as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    if ('result' in v) return v.result === undefined || v.result === null ? '' : cellText(v.result as CellValue);
    if ('error' in v) return '';
    return '';
  }
  return String(v);
}
