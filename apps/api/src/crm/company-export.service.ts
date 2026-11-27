import { ForbiddenException, Injectable } from '@nestjs/common';
import { type Prisma, type TenantTx } from '@dealflow/database';
import { Workbook } from 'exceljs';
import {
  allowsExport,
  type CompanyAddress,
  type CompanyRow,
  type ContactPoint,
  type ContactRow,
  customFieldText,
  type CustomFieldDef,
  type ExportFormat,
  FIELD_SOURCE_LABELS,
  GEO_COUNTRIES,
  type ListQuery,
  type Permission,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { featureNotIncluded, hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from './crm-helpers';
import { CompaniesService, type CompanyFilters } from './companies.service';
import { contactContext, contactInclude, toContactRow } from './contacts.service';
import { CrmAdminService } from './crm-admin.service';
import { CustomFieldsService } from './custom-fields.service';
import { csvCell } from './csv';
import { MAX_EXPORT_ROWS } from './import-export.service';
import { contactScope, personRefs, visibility } from './visibility';

/**
 * Company export (ADR 0079): every stored company field, the company's employees, branches and logged
 * interactions, as one Excel workbook or as one CSV file per part. Nothing is looked up or generated: the export
 * reads what the CRM holds. It follows the list filters, record visibility (hidden details stay blank), the role's
 * export policy and the plan (Excel needs `excel_export`).
 */
export const COMPANY_EXPORT_PARTS = ['companies', 'employees', 'branches', 'interactions'] as const;
export type CompanyExportPart = (typeof COMPANY_EXPORT_PARTS)[number];

export interface CompanyExportRequest {
  format: ExportFormat;
  /** CSV only: which file. Excel always holds every part the caller may export. */
  part?: CompanyExportPart;
  /** One company (from its page) instead of the filtered list. */
  companyId?: string;
  q?: Pick<ListQuery, 'q' | 'sort' | 'order' | 'ownerId' | 'status'>;
  f?: CompanyFilters;
}

export interface ExportFile {
  data: string | Buffer;
  rows: number;
  contentType: string;
  extension: string;
  filename: string;
}

interface Sheet {
  name: string;
  headers: string[];
  rows: unknown[][];
}

interface Column<T> {
  header: string;
  value: (r: T) => unknown;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Profile columns that are always there, so files of different exports line up; other platforms only when used. */
const MAIN_SOCIAL: SocialPlatform[] = ['x', 'facebook', 'instagram', 'youtube'];
const COUNTRY_NAME = new Map(GEO_COUNTRIES.map((c) => [c.code, c.name]));
/** The part each CSV file holds, and what the caller needs for it besides company export rights. */
const PART_NEEDS: Record<CompanyExportPart, { permission?: Permission; policy?: 'contacts' }> = {
  companies: {},
  branches: {},
  employees: { permission: 'contacts:read', policy: 'contacts' },
  interactions: { permission: 'activities:read' },
};

const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const list = (values: readonly (string | null | undefined)[] | null | undefined) => (values ?? []).filter((v): v is string => !!v && v.trim() !== '').join('; ') || null;
/** "sales@acme.com (Sales); info@acme.com", primary first. */
const pointList = (points: ContactPoint[]) => list([...points].sort((a, b) => Number(b.primary) - Number(a.primary)).map((p) => (p.label ? `${p.value} (${p.label})` : p.value)));
const addressText = (a: CompanyAddress) =>
  [a.label ? `${a.label}:` : null, a.address, a.city, a.state, a.postalCode, a.country ? (COUNTRY_NAME.get(a.country) ?? a.country) : null].filter(Boolean).join(' ').trim();
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';

@Injectable()
export class CompanyExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
    private readonly admin: CrmAdminService,
    private readonly companies: CompaniesService,
  ) {}

  export(auth: AuthContext, req: CompanyExportRequest, meta: RequestMeta): Promise<ExportFile> {
    return this.prisma.run(
      auth,
      async (tx) => {
        const { format } = req;
        const part = format === 'csv' ? (req.part ?? 'companies') : null;
        const policy = await this.admin.exportPolicyFor(tx, auth);
        if (!allowsExport(policy, 'companies', format)) {
          throw new ForbiddenException({ code: 'EXPORT_NOT_ALLOWED', message: 'Your role cannot export these records in this format.', details: [{ path: 'format', message: format }] });
        }
        if (format === 'xlsx' && !(await hasFeature(tx, auth.tenantId, 'excel_export'))) throw featureNotIncluded('excel_export');

        // Which parts this person may have. A CSV part they may not have is refused; Excel leaves its sheet out.
        const allowed = async (p: CompanyExportPart) => {
          const need = PART_NEEDS[p];
          if (need.permission && !auth.permissions.includes(need.permission)) return false;
          if (need.policy && !allowsExport(policy, need.policy, format)) return false;
          if (p === 'interactions' && !(await hasFeature(tx, auth.tenantId, 'interactions'))) return false;
          return true;
        };
        if (part && !(await allowed(part))) {
          throw new ForbiddenException({ code: 'EXPORT_NOT_ALLOWED', message: 'Your role cannot export these records in this format.', details: [{ path: 'part', message: part }] });
        }
        const wanted = part ? [part] : (await Promise.all(COMPANY_EXPORT_PARTS.map(async (p) => ((await allowed(p)) ? p : null)))).filter((p): p is CompanyExportPart => !!p);
        const noContact = policy?.withoutContactDetails === true;

        const v = await visibility(tx, auth);
        const companies = await this.companies.rowsForExport(tx, auth, v, req.q ?? { order: 'desc' }, req.f ?? {}, MAX_EXPORT_ROWS, req.companyId);
        if (req.companyId && !companies.length) throw notFound('Company');
        const byId = new Map(companies.map((c) => [c.id, c]));
        const ids = companies.map((c) => c.id);

        const sheets: Sheet[] = [];
        let truncated = companies.length >= MAX_EXPORT_ROWS;
        let employees: ContactRow[] = [];
        if (wanted.includes('companies')) sheets.push(await this.companySheet(tx, auth, companies.map((c) => (noContact ? withoutContactDetails(c) : c))));
        if (wanted.includes('employees') || wanted.includes('interactions')) {
          employees = ids.length ? await this.employees(tx, auth, v, ids) : [];
          truncated ||= employees.length >= MAX_EXPORT_ROWS;
        }
        if (wanted.includes('employees')) sheets.push(await this.employeeSheet(tx, auth, employees.map((e) => (noContact ? { ...e, email: null, phone: null, emails: [], phones: [], linkedinUrl: null } : e)), byId));
        if (wanted.includes('branches')) sheets.push(await branchSheet(tx, auth.tenantId, ids, byId, noContact));
        if (wanted.includes('interactions')) {
          const s = await interactionSheet(tx, auth.tenantId, byId, employees);
          truncated ||= s.rows.length >= MAX_EXPORT_ROWS;
          sheets.push(s);
        }

        const rows = sheets.find((s) => s.name === 'Companies')?.rows.length ?? sheets[0]?.rows.length ?? 0;
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'data.exported',
          entityType: 'companies',
          entityId: req.companyId,
          metadata: { format, parts: sheets.map((s) => s.name), rows: Object.fromEntries(sheets.map((s) => [s.name, s.rows.length])), truncated, filtered: !!(req.q?.q || req.q?.ownerId || req.q?.status || Object.values(req.f ?? {}).some(Boolean)) },
          meta,
        });

        const day = new Date().toISOString().slice(0, 10);
        const one = req.companyId ? companies[0]! : null;
        const base = one ? `sampforce-${[one.leadNumber, slug(one.name)].filter(Boolean).join('-')}` : 'sampforce-companies';
        if (format === 'xlsx') {
          return { data: await toWorkbook(sheets), rows, contentType: XLSX_TYPE, extension: 'xlsx', filename: `${base}-${day}.xlsx` };
        }
        const sheet = sheets[0]!;
        const suffix = part === 'companies' ? '' : `-${part}`;
        return { data: toCsvWithBom(sheet.headers, sheet.rows), rows: sheet.rows.length, contentType: 'text/csv; charset=utf-8', extension: 'csv', filename: `${base}${suffix}-${day}.csv` };
      },
      { timeoutMs: 120_000 },
    );
  }

  private async customFieldColumns<T>(tx: TenantTx, auth: AuthContext, entity: 'COMPANY' | 'CONTACT', values: (r: T) => Record<string, unknown>, taken: Set<string>): Promise<Column<T>[]> {
    // Only fields the person may see; the rows already carry only visible values (hidden conditions left out).
    const { defs } = await this.fields.accessFor(tx, auth, entity);
    return defs
      .filter((d) => d.access.view)
      .map((d: CustomFieldDef) => ({ header: uniqueHeader(d.label, taken), value: (r: T) => customFieldText(d.type, values(r)[d.key]) || null }));
  }

  private async companySheet(tx: TenantTx, auth: AuthContext, rows: CompanyRow[]): Promise<Sheet> {
    const used = new Set(rows.flatMap((r) => r.socialLinks.map((l) => l.platform)));
    const platforms = SOCIAL_PLATFORMS.filter((p) => p !== 'linkedin' && (MAIN_SOCIAL.includes(p) || used.has(p)));
    const social = (r: CompanyRow, p: SocialPlatform) => list(r.socialLinks.filter((l) => l.platform === p).map((l) => l.url));
    const linkedin = (r: CompanyRow) => [...new Set([r.linkedinUrl, ...r.linkedinUrls.map((l) => l.value), ...r.socialLinks.filter((l) => l.platform === 'linkedin').map((l) => l.url)].filter((u): u is string => !!u))];
    const websites = (r: CompanyRow) => [...new Set([r.website, ...r.websites.map((w) => w.value)].filter((u): u is string => !!u))];

    const fixed: Column<CompanyRow>[] = [
      { header: 'Lead number', value: (r) => r.leadNumber },
      { header: 'Company name', value: (r) => r.name },
      { header: 'Legal name', value: (r) => r.legalName },
      { header: 'Lead status', value: (r) => r.status?.name },
      { header: 'Operating status', value: (r) => r.operatingStatus },
      { header: 'Description', value: (r) => r.overview },
      { header: 'Industry', value: (r) => r.industry },
      { header: 'Business category', value: (r) => r.businessCategory },
      { header: 'Specialties', value: (r) => r.specialties },
      { header: 'Services', value: (r) => list(r.services) },
      { header: 'Products', value: (r) => list(r.products) },
      { header: 'Industries served', value: (r) => list(r.industriesServed) },
      { header: 'Founded', value: (r) => r.foundedYear },
      { header: 'Employees', value: (r) => r.employeeCount },
      { header: 'Company size', value: (r) => r.companySize },
      { header: 'Company type', value: (r) => r.companyType },
      { header: 'Number of branches', value: (r) => r.branchCount },
      { header: 'Parent company', value: (r) => r.parentCompany?.name ?? r.parentCompanyName },
      { header: 'Parent company (public name)', value: (r) => r.parentCompanyName },
      { header: 'Ownership', value: (r) => r.ownership },
      { header: 'Founders', value: (r) => list(r.founders) },
      { header: 'CEO', value: (r) => r.ceo },
      { header: 'Leadership', value: (r) => list(r.leadership.map((l) => (l.title ? `${l.name} (${l.title})` : l.name))) },
      { header: 'Certifications', value: (r) => list(r.certifications) },
      { header: 'Country code', value: (r) => r.country },
      { header: 'Country', value: (r) => (r.country ? (COUNTRY_NAME.get(r.country) ?? r.country) : null) },
      { header: 'Headquarters', value: (r) => r.headquarters },
      { header: 'State or region', value: (r) => r.state },
      { header: 'City', value: (r) => r.city },
      { header: 'Street address', value: (r) => r.address },
      { header: 'Postal code', value: (r) => r.postalCode },
      { header: 'Time zone', value: (r) => r.timezone },
      { header: 'Other offices', value: (r) => list(r.addresses.map(addressText)) },
      { header: 'Primary email', value: (r) => r.primaryEmail },
      { header: 'All emails', value: (r) => pointList(r.emails) },
      { header: 'Primary phone', value: (r) => r.primaryPhone },
      { header: 'All phones', value: (r) => pointList(r.phones) },
      { header: 'Contact page', value: (r) => r.contactPageUrl },
      { header: 'Website', value: (r) => r.website ?? websites(r)[0] },
      { header: 'All websites', value: (r) => list(websites(r)) },
      { header: 'Domain', value: (r) => r.domain },
      { header: 'LinkedIn', value: (r) => linkedin(r)[0] },
      { header: 'All LinkedIn pages', value: (r) => list(linkedin(r)) },
      ...platforms.map((p) => ({ header: SOCIAL_PLATFORM_LABELS[p], value: (r: CompanyRow) => social(r, p) })),
      { header: 'All social profiles', value: (r) => list(r.socialLinks.map((l) => `${SOCIAL_PLATFORM_LABELS[l.platform]}: ${l.url}`)) },
    ];
    const taken = new Set(fixed.map((c) => c.header));
    // Each "more detail" label (slogan, VAT number, DUNS, LEI, ticker…) gets a column of its own.
    const labels = [...new Map(rows.flatMap((r) => r.moreDetails.map((d) => [d.label.trim().toLowerCase(), d.label.trim()] as const))).values()];
    const more: Column<CompanyRow>[] = labels.map((label) => ({
      header: uniqueHeader(label, taken),
      value: (r) => list(r.moreDetails.filter((d) => d.label.trim().toLowerCase() === label.toLowerCase()).map((d) => d.value)),
    }));
    const tail: Column<CompanyRow>[] = [
      { header: uniqueHeader('All more details', taken), value: (r) => list(r.moreDetails.map((d) => `${d.label}: ${d.value}`)) },
      { header: uniqueHeader('Remarks', taken), value: (r) => r.notes },
      { header: uniqueHeader('AI summary (generated)', taken), value: (r) => r.aiSummary },
    ];
    const cf = await this.customFieldColumns<CompanyRow>(tx, auth, 'COMPANY', (r) => r.customFields, taken);
    const after: Column<CompanyRow>[] = [
      { header: uniqueHeader('Lead owner', taken), value: (r) => r.ownerPerson?.name ?? r.owner?.name },
      { header: uniqueHeader('Created by', taken), value: (r) => r.createdBy?.name },
      { header: uniqueHeader('Manager', taken), value: (r) => r.manager?.name },
      { header: uniqueHeader('Point of contact', taken), value: (r) => r.poc?.name },
      { header: uniqueHeader('Department', taken), value: (r) => r.department?.name },
      { header: uniqueHeader('Team', taken), value: (r) => r.team?.name },
      { header: uniqueHeader('Employees in CRM', taken), value: (r) => r.contactCount },
      { header: uniqueHeader('Open deals', taken), value: (r) => r.openDealCount },
      { header: uniqueHeader('Created at', taken), value: (r) => date(r.createdAt) },
      { header: uniqueHeader('Updated at', taken), value: (r) => date(r.updatedAt) },
      { header: uniqueHeader('Status changed at', taken), value: (r) => date(r.statusChangedAt) },
      { header: uniqueHeader('Where details came from', taken), value: (r) => sourcesText(r) },
      { header: uniqueHeader('Details hidden', taken), value: (r) => (r.restricted ? 'Yes: owned by someone else' : null) },
      { header: uniqueHeader('SampForce company ID', taken), value: (r) => r.id },
    ];
    return sheetOf('Companies', [...fixed, ...more, ...tail, ...cf, ...after], rows);
  }

  private async employees(tx: TenantTx, auth: AuthContext, v: Awaited<ReturnType<typeof visibility>>, companyIds: string[]): Promise<ContactRow[]> {
    const rows = await tx.contact.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null, companyId: { in: companyIds }, ...contactScope(v) },
      include: contactInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_EXPORT_ROWS,
    });
    const ctx = await contactContext(tx, auth.tenantId, rows, v, await this.fields.reader(tx, auth, 'CONTACT'));
    const order = new Map(companyIds.map((id, i) => [id, i]));
    // Grouped by company in the order of the Companies sheet.
    return rows.map((r) => toContactRow(r, ctx.owners, ctx)).sort((a, b) => (order.get(a.company?.id ?? '') ?? 0) - (order.get(b.company?.id ?? '') ?? 0));
  }

  private async employeeSheet(tx: TenantTx, auth: AuthContext, rows: ContactRow[], companies: Map<string, CompanyRow>): Promise<Sheet> {
    const company = (r: ContactRow) => (r.company ? companies.get(r.company.id) : undefined);
    const fixed: Column<ContactRow>[] = [
      { header: 'Lead number', value: (r) => company(r)?.leadNumber },
      { header: 'Company name', value: (r) => r.company?.name },
      { header: 'Full name', value: (r) => r.fullName },
      { header: 'First name', value: (r) => r.firstName },
      { header: 'Last name', value: (r) => r.lastName },
      { header: 'Designation', value: (r) => r.jobTitle },
      { header: 'Department', value: (r) => r.department },
      { header: 'Status', value: (r) => r.status?.name },
      { header: 'Email', value: (r) => r.email },
      { header: 'All emails', value: (r) => pointList(r.emails) },
      { header: 'Phone', value: (r) => r.phone },
      { header: 'All phones', value: (r) => pointList(r.phones) },
      { header: 'LinkedIn', value: (r) => r.linkedinUrl },
      { header: 'Country code', value: (r) => r.country },
      { header: 'Country', value: (r) => (r.country ? (COUNTRY_NAME.get(r.country) ?? r.country) : null) },
      { header: 'State or region', value: (r) => r.state },
      { header: 'City', value: (r) => r.city },
      { header: 'Time zone', value: (r) => r.timezone },
      { header: 'Remarks', value: (r) => r.remarks },
      { header: 'Next follow-up', value: (r) => date(r.nextFollowUpAt) },
      { header: 'Email check', value: (r) => r.emailStatus },
      { header: 'Marketing consent', value: (r) => r.marketingConsent },
    ];
    const taken = new Set(fixed.map((c) => c.header));
    const cf = await this.customFieldColumns<ContactRow>(tx, auth, 'CONTACT', (r) => r.customFields, taken);
    const after: Column<ContactRow>[] = [
      { header: uniqueHeader('Owner', taken), value: (r) => r.ownerPerson?.name ?? r.owner?.name },
      { header: uniqueHeader('Created by', taken), value: (r) => r.createdBy?.name },
      { header: uniqueHeader('Created at', taken), value: (r) => date(r.createdAt) },
      { header: uniqueHeader('Updated at', taken), value: (r) => date(r.updatedAt) },
      { header: uniqueHeader('Details hidden', taken), value: (r) => (r.restricted ? 'Yes: owned by someone else' : null) },
      { header: uniqueHeader('SampForce employee ID', taken), value: (r) => r.id },
      { header: uniqueHeader('SampForce company ID', taken), value: (r) => r.company?.id },
    ];
    return sheetOf('Employees', [...fixed, ...cf, ...after], rows);
  }
}

/** Hides emails, phones and profile links when the role exports without contact details (ADR 0062). */
function withoutContactDetails(c: CompanyRow): CompanyRow {
  return { ...c, primaryEmail: null, primaryPhone: null, emails: [], phones: [], linkedinUrl: null, linkedinUrls: [], socialLinks: [], contactPageUrl: null };
}

async function branchSheet(tx: TenantTx, tenantId: string, ids: string[], companies: Map<string, CompanyRow>, noContact: boolean): Promise<Sheet> {
  const rows = ids.length ? await tx.companyBranch.findMany({ where: { tenantId, companyId: { in: ids } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_EXPORT_ROWS }) : [];
  type Branch = (typeof rows)[number];
  // Branch details follow the company's: hidden when its details are hidden.
  const shown = (r: Branch, value: string | null, contact = false) => (companies.get(r.companyId)?.restricted || (contact && noContact) ? null : value);
  const cols: Column<Branch>[] = [
    { header: 'Lead number', value: (r) => companies.get(r.companyId)?.leadNumber },
    { header: 'Company name', value: (r) => companies.get(r.companyId)?.name },
    { header: 'Branch name', value: (r) => r.name },
    { header: 'Country code', value: (r) => r.country },
    { header: 'Country', value: (r) => (r.country ? (COUNTRY_NAME.get(r.country) ?? r.country) : null) },
    { header: 'State or region', value: (r) => r.state },
    { header: 'City', value: (r) => r.city },
    { header: 'Street address', value: (r) => shown(r, r.address) },
    { header: 'Postal code', value: (r) => shown(r, r.postalCode) },
    { header: 'Email', value: (r) => shown(r, r.email, true) },
    { header: 'Phone', value: (r) => shown(r, r.phone, true) },
    { header: 'Contact person', value: (r) => shown(r, r.contactPerson, true) },
    { header: 'Website', value: (r) => shown(r, r.website) },
    { header: 'SampForce company ID', value: (r) => r.companyId },
  ];
  return sheetOf('Branches', cols, rows);
}

/** Interactions logged on the companies or on their employees, newest first. Notes are blank where details are hidden. */
async function interactionSheet(tx: TenantTx, tenantId: string, companies: Map<string, CompanyRow>, employees: ContactRow[]): Promise<Sheet> {
  const ids = [...companies.keys()];
  const companyOf = new Map(employees.filter((e) => e.company).map((e) => [e.id, e.company!.id]));
  const name = new Map(employees.map((e) => [e.id, e.fullName]));
  const where: Prisma.ActivityWhereInput = { tenantId, deletedAt: null, OR: [{ companyId: { in: ids } }, ...(companyOf.size ? [{ contactId: { in: [...companyOf.keys()] } }] : [])] };
  const rows = ids.length ? await tx.activity.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: MAX_EXPORT_ROWS }) : [];
  const people = await personRefs(tx, tenantId, rows.map((r) => r.ownerId));
  type Act = (typeof rows)[number];
  const company = (r: Act) => companies.get(r.companyId ?? companyOf.get(r.contactId ?? '') ?? '');
  const shown = <T>(r: Act, value: T) => (company(r)?.restricted ? null : value);
  const cols: Column<Act>[] = [
    { header: 'Lead number', value: (r) => company(r)?.leadNumber },
    { header: 'Company name', value: (r) => company(r)?.name },
    { header: 'Date', value: (r) => r.occurredAt },
    { header: 'Kind', value: (r) => titleCase(r.interaction ?? r.type) },
    { header: 'Subject', value: (r) => r.subject },
    { header: 'Notes', value: (r) => shown(r, r.body) },
    { header: 'Employee', value: (r) => (r.contactId ? name.get(r.contactId) : null) },
    { header: 'From', value: (r) => shown(r, r.sender) },
    { header: 'To', value: (r) => shown(r, r.recipient) },
    { header: 'Outcome', value: (r) => shown(r, r.outcome) },
    { header: 'Next action', value: (r) => shown(r, r.nextAction) },
    { header: 'Follow-up at', value: (r) => r.followUpAt },
    { header: 'Client response', value: (r) => (r.sentiment ? titleCase(r.sentiment) : null) },
    { header: 'Logged by', value: (r) => (r.ownerId ? people.get(r.ownerId)?.name : null) },
    { header: 'SampForce company ID', value: (r) => company(r)?.id },
  ];
  return sheetOf('Interactions', cols, rows);
}

function sheetOf<T>(name: string, cols: Column<T>[], rows: T[]): Sheet {
  return { name, headers: cols.map((c) => c.header), rows: rows.map((r) => cols.map((c) => c.value(r) ?? null)) };
}

function uniqueHeader(label: string, taken: Set<string>): string {
  let h = label;
  for (let i = 2; taken.has(h); i++) h = `${label} (${i})`;
  taken.add(h);
  return h;
}

function titleCase(s: string): string {
  const t = s.toLowerCase().replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Industry: Company website https://acme.example/about (2026-11-24); CEO: Entered by you". */
function sourcesText(r: CompanyRow): string | null {
  return list(
    Object.entries(r.fieldSources ?? {}).map(([field, s]) => {
      const what = FIELD_SOURCE_LABELS[s.source] ?? s.source;
      return `${field}: ${[what, s.url, s.at ? `(${s.at.slice(0, 10)})` : null].filter(Boolean).join(' ')}`;
    }),
  );
}

/** CSV that Excel opens as UTF-8 (byte order mark), with formula-like values neutralised. */
export function toCsvWithBom(headers: string[], rows: unknown[][]): string {
  const cell = (c: unknown) => csvCell(c instanceof Date ? c.toISOString().replace('T', ' ').slice(0, 19) : c);
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * One workbook, one sheet per part: bold frozen header with filters, dates as dates, web addresses as links.
 * Every other value is a text cell (never a formula), so "=…" in a remark stays text and "+91…" stays a phone number.
 */
export async function toWorkbook(sheets: Sheet[]): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'SampForce';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow(s.headers);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: Math.min(2, s.headers.length) }];
    if (s.headers.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.headers.length } };
    const widths = s.headers.map((h) => h.length);
    for (const r of s.rows) {
      const row = ws.addRow(
        r.map((c, i) => {
          if (c === null || c === undefined) return null;
          if (c instanceof Date) return c;
          if (typeof c === 'number' || typeof c === 'boolean') return c;
          const t = String(c).slice(0, 32_000);
          widths[i] = Math.max(widths[i] ?? 0, Math.min(t.length, 60));
          if (/^https?:\/\/\S+$/i.test(t)) return { text: t, hyperlink: t };
          // Written as a text cell: Excel never runs it as a formula, so phone numbers keep their leading +.
          return t;
        }),
      );
      row.eachCell((cell) => {
        if (typeof cell.value === 'object' && cell.value && 'hyperlink' in cell.value) cell.font = { color: { argb: 'FF0563C1' }, underline: true };
      });
    }
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = Math.min(60, Math.max(10, w + 2))));
    s.rows.forEach((r, ri) => r.forEach((c, ci) => c instanceof Date && (ws.getCell(ri + 2, ci + 1).numFmt = 'yyyy-mm-dd hh:mm')));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
