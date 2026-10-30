import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  companyInputSchema,
  contactInputSchema,
  type ImportEntity,
  type ImportRequest,
  type ImportResult,
  leadInputSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ownerRefs } from './crm-helpers';
import { parseCsv, toCsv } from './csv';
import { CustomFieldsService } from './custom-fields.service';
import { phoneDigits } from './leads.service';

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_EXPORT_ROWS = 50_000;
export const EXPORT_ENTITIES = ['leads', 'contacts', 'companies', 'deals'] as const;
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
            result.errors.push({ row: rowNumber, message: parsed.error.issues.map((e) => `${e.path.join('.') || 'row'}: ${e.message}`).join('; ') });
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

        const base = { tenantId: auth.tenantId, ownerId: auth.userId };
        if (req.entity === 'leads') {
          await chunks(toCreate, (batch) =>
            tx.lead.createMany({ data: batch.map((p) => ({ ...base, ...(p.data as object), tags: (p.data.tags as string[]) ?? [] }) as Prisma.LeadCreateManyInput) }),
          );
        } else if (req.entity === 'companies') {
          await chunks(toCreate, (batch) => tx.company.createMany({ data: batch.map((p) => ({ ...base, ...(p.data as object) }) as Prisma.CompanyCreateManyInput) }));
        } else {
          const companyIds = await this.resolveCompanies(tx, auth, toCreate.map((p) => p.companyName).filter((n): n is string => !!n));
          await chunks(toCreate, (batch) =>
            tx.contact.createMany({
              data: batch.map((p) => ({ ...base, ...(p.data as object), companyId: p.companyName ? (companyIds.get(p.companyName.toLowerCase()) ?? null) : null }) as Prisma.ContactCreateManyInput),
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

  async export(auth: AuthContext, entity: ExportEntity, meta: RequestMeta): Promise<{ csv: string; rows: number }> {
    return this.prisma.run(
      auth,
      async (tx) => {
        const cfEntity = ({ leads: 'LEAD', contacts: 'CONTACT', companies: 'COMPANY', deals: 'OPPORTUNITY' } as const)[entity];
        const defs = await this.fields.definitions(tx, auth.tenantId, cfEntity);
        const cfHeaders = defs.map((d) => `customFields.${d.key}`);
        const cf = (v: unknown) => defs.map((d) => ((v ?? {}) as Record<string, unknown>)[d.key]);
        const where = { tenantId: auth.tenantId, deletedAt: null };
        const take = MAX_EXPORT_ROWS;
        let headers: string[];
        let body: unknown[][];

        if (entity === 'leads') {
          const rows = await tx.lead.findMany({ where, orderBy: { createdAt: 'asc' }, take });
          const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
          headers = ['id', ...IMPORT_FIELDS.leads, 'owner', 'createdAt', ...cfHeaders];
          body = rows.map((r) => [
            r.id, r.fullName, r.companyName, r.jobTitle, r.industry, r.email, r.phone, r.country, r.city, r.timezone, r.website,
            r.source, r.campaignSource, r.estimatedValue?.toString(), r.currency, r.status, r.tags,
            r.ownerId ? owners.get(r.ownerId)?.name : null, r.createdAt, ...cf(r.customFields),
          ]);
        } else if (entity === 'contacts') {
          const rows = await tx.contact.findMany({ where, include: { company: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take });
          const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
          headers = ['id', ...IMPORT_FIELDS.contacts, 'owner', 'createdAt', ...cfHeaders];
          body = rows.map((r) => [
            r.id, r.firstName, r.lastName, r.email, r.phone, r.jobTitle, r.country, r.timezone, r.company?.name,
            r.ownerId ? owners.get(r.ownerId)?.name : null, r.createdAt, ...cf(r.customFields),
          ]);
        } else if (entity === 'companies') {
          const rows = await tx.company.findMany({ where, orderBy: { createdAt: 'asc' }, take });
          const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
          headers = ['id', ...IMPORT_FIELDS.companies, 'owner', 'createdAt', ...cfHeaders];
          body = rows.map((r) => [r.id, r.name, r.domain, r.industry, r.country, r.ownerId ? owners.get(r.ownerId)?.name : null, r.createdAt, ...cf(r.customFields)]);
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
          metadata: { rows: body.length, truncated: body.length >= take }, meta,
        });
        return { csv: toCsv(headers, body), rows: body.length };
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
    const table = entity === 'leads' ? Prisma.sql`leads` : entity === 'contacts' ? Prisma.sql`contacts` : Prisma.sql`companies`;
    if (emails.length && entity !== 'companies') {
      const rows = await tx.$queryRaw<{ v: string }[]>`SELECT lower(email) AS v FROM ${table} WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND lower(email) = ANY(${emails})`;
      rows.forEach((r) => found.add(`email:${r.v}`));
    }
    if (phones.length && entity !== 'companies') {
      const rows = await tx.$queryRaw<{ v: string }[]>`SELECT right(regexp_replace(phone, '\\D', '', 'g'), 10) AS v FROM ${table} WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND phone IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ANY(${phones})`;
      rows.forEach((r) => found.add(`phone:${r.v}`));
    }
    if (entity === 'companies') {
      if (names.length) {
        const rows = await tx.$queryRaw<{ v: string }[]>`SELECT lower(name) AS v FROM companies WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND lower(name) = ANY(${names})`;
        rows.forEach((r) => found.add(`name:${r.v}`));
      }
      if (domains.length) {
        const rows = await tx.$queryRaw<{ v: string }[]>`SELECT lower(domain) AS v FROM companies WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND lower(domain) = ANY(${domains})`;
        rows.forEach((r) => found.add(`domain:${r.v}`));
      }
    }
    return found;
  }

  /** Matches company names case-insensitively, creating the ones that do not exist yet. */
  private async resolveCompanies(tx: TenantTx, auth: AuthContext, names: string[]): Promise<Map<string, string>> {
    const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).entries()];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    const rows = await tx.$queryRaw<{ id: string; v: string }[]>`SELECT DISTINCT ON (lower(name)) id::text, lower(name) AS v FROM companies WHERE tenant_id = ${auth.tenantId}::uuid AND deleted_at IS NULL AND lower(name) = ANY(${unique.map(([k]) => k)}) ORDER BY lower(name), created_at`;
    rows.forEach((r) => map.set(r.v, r.id));
    for (const [key, name] of unique) {
      if (map.has(key)) continue;
      const c = await tx.company.create({ data: { tenantId: auth.tenantId, ownerId: auth.userId, name: name.slice(0, 200) }, select: { id: true } });
      map.set(key, c.id);
    }
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
    return body.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? body.message ?? 'Invalid row';
  }
  throw err;
}
