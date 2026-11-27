import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { assignLeadNumbers, Prisma, type TenantTx } from '@dealflow/database';
import {
  combinedImportTargets,
  companyInputSchema,
  companyNameKey,
  contactInputSchema,
  countryCodeFrom,
  type CustomFieldDef,
  customFieldKeyFor,
  customFieldLabelFor,
  CUSTOM_FIELD_LIMITS,
  headingSide,
  IMPORT_FIELD_ALIASES,
  type ImportEntity,
  type ImportNewField,
  type ImportRequest,
  type ImportResult,
  type ImportTarget,
  leadInputSchema,
  matchKeys,
  NEW_FIELD_TARGETS,
  suggestMapping,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { localize, tr } from '../common/request-language';
import { parseCsv } from './csv';
import { FollowUpCadenceService } from './follow-up-cadence.service';
import { CompanyEnrichmentService } from './company-enrichment.service';
import { CustomFieldsService } from './custom-fields.service';
import { defaultStatusId, reportingManagerOf } from './companies.service';
import { phoneDigits } from './leads.service';
import { canSeeDetails, companyScope, visibility } from './visibility';

export const MAX_IMPORT_ROWS = 5_000;

const COMPANY_FIELDS = ['name', 'website', 'domain', 'linkedinUrl', 'industry', 'country', 'state', 'city', 'address', 'postalCode', 'primaryEmail', 'primaryPhone', 'companySize', 'companyType', 'timezone', 'notes'];
const CONTACT_FIELDS = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'jobTitle', 'department', 'linkedinUrl', 'country', 'state', 'city', 'timezone', 'remarks'];

/** Built-in fields a column can map to. Custom fields map as `customFields.<key>` (combined: `company.customFields.<key>`). */
export const IMPORT_FIELDS: Record<ImportEntity, string[]> = {
  leads: ['fullName', 'companyName', 'jobTitle', 'industry', 'email', 'phone', 'country', 'city', 'timezone', 'website', 'source', 'campaignSource', 'estimatedValue', 'currency', 'status', 'tags'],
  contacts: [...CONTACT_FIELDS, 'companyName'],
  companies: COMPANY_FIELDS,
  companies_contacts: [...COMPANY_FIELDS.map((f) => `company.${f}`), ...CONTACT_FIELDS.map((f) => `contact.${f}`)],
};

type Side = 'company' | 'contact';
type FieldEntity = 'LEAD' | 'CONTACT' | 'COMPANY';
const ENTITY_KEY: Record<Exclude<ImportEntity, 'companies_contacts'>, FieldEntity> = { leads: 'LEAD', contacts: 'CONTACT', companies: 'COMPANY' };
const SIDE_ENTITY: Record<Side, FieldEntity> = { company: 'COMPANY', contact: 'CONTACT' };
const REQUIRED: Record<ImportEntity, { any: string[]; label: string }> = {
  leads: { any: ['fullName'], label: 'Full name' },
  contacts: { any: ['firstName', 'fullName'], label: 'Employee name' },
  companies: { any: ['name'], label: 'Company name' },
  companies_contacts: { any: ['company.name'], label: 'Company name' },
};
const CF = /^(?:(company|contact)\.)?customFields\.([a-z][a-z0-9_]{1,39})$/;

interface Column {
  index: number;
  heading: string;
  target: string;
}

/** One row's values for one record: built-in fields and custom field values. */
interface Values {
  raw: Record<string, string>;
  custom: Record<string, string>;
}

/**
 * Imports (ADR 0066). Columns map to fields by name, synonym or a close spelling; columns nothing matches become new
 * custom fields; one row can hold a company and one of its employees. Every row is checked with the create
 * endpoints' schemas, and a dry run does all of it without writing anything.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
    private readonly enrichment: CompanyEnrichmentService,
    private readonly cadence: FollowUpCadenceService,
  ) {}

  async import(auth: AuthContext, req: ImportRequest, meta: RequestMeta): Promise<ImportResult> {
    // Blank lines are kept while reading so row numbers match the spreadsheet's line numbers.
    const all = parseCsv(req.csv, { keepBlankRows: true });
    let skipped = 0;
    while (all.length && all[0]!.every((c) => c.trim() === '')) {
      all.shift();
      skipped++;
    }
    const header = all.shift()?.map((h) => h.trim()) ?? [];
    if (header.length === 0 || header.every((h) => !h)) throw invalid('csv', 'The file has no header row.');
    // Blank lines (a trailing newline, spacer rows in a spreadsheet) are not rows.
    const rows = all.map((cells, i) => ({ cells, row: i + 2 + skipped })).filter((r) => r.cells.some((c) => c.trim() !== ''));
    if (rows.length > MAX_IMPORT_ROWS) throw invalid('csv', `Import at most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows at a time.`);

    return this.prisma.run(
      auth,
      async (tx) => {
        const entities: FieldEntity[] = req.entity === 'companies_contacts' ? ['COMPANY', 'CONTACT'] : [ENTITY_KEY[req.entity]];
        const defs = new Map<FieldEntity, CustomFieldDef[]>();
        for (const e of entities) defs.set(e, (await this.fields.definitions(tx, auth.tenantId, e)).filter((d) => d.type !== 'FORMULA'));

        const { columns, newFields, mapping } = await this.resolveColumns(tx, auth, req, header, rows.map((r) => r.cells), defs);
        const result: ImportResult = { entity: req.entity, dryRun: req.dryRun, totalRows: rows.length, created: 0, skippedDuplicates: 0, errors: [], mapping, newFields };

        // New fields exist for the check as they will once saved; the real run creates them first.
        if (!req.dryRun && newFields.length) await this.fields.createForImport(tx, auth, newFields, meta);
        for (const f of newFields) defs.get(f.entity)!.push(syntheticDef(f));

        const read = (cells: string[], side?: Side): Values => {
          const v: Values = { raw: {}, custom: {} };
          for (const c of columns) {
            const value = (cells[c.index] ?? '').trim();
            const m = CF.exec(c.target);
            if (m) {
              if ((m[1] ?? undefined) === side && value !== '') v.custom[m[2]!] = value;
              continue;
            }
            const [s, field] = c.target.includes('.') ? (c.target.split('.') as [Side, string]) : [undefined, c.target];
            if (s === side && value !== '') v.raw[field] = value;
          }
          return v;
        };

        if (req.entity === 'companies_contacts') await this.importCombined(tx, auth, req, rows, read, defs, result);
        else await this.importSingle(tx, auth, req, rows, read, defs.get(ENTITY_KEY[req.entity])!, result);

        if (!req.dryRun) {
          await this.audit.record(tx, {
            tenantId: auth.tenantId, actorUserId: auth.userId, action: 'data.imported', entityType: req.entity,
            metadata: {
              totalRows: result.totalRows, created: result.created, skippedDuplicates: result.skippedDuplicates, errors: result.errors.length,
              newFields: newFields.map((f) => `${f.entity}.${f.key}`), companiesCreated: result.companiesCreated, companiesMatched: result.companiesMatched, contactsCreated: result.contactsCreated,
            },
            meta,
          });
        }
        return result;
      },
      { timeoutMs: 120_000 },
    );
  }

  // ───────────── Columns ─────────────

  /** The import's targets with their names and synonyms, for automatic matching. */
  private targets(entity: ImportEntity, defs: Map<FieldEntity, CustomFieldDef[]>): ImportTarget[] {
    const custom = (prefix: string, list: CustomFieldDef[] = []) => list.map((d) => ({ value: `${prefix}customFields.${d.key}`, label: d.label, aliases: [d.key] }));
    if (entity === 'companies_contacts') {
      return [...combinedImportTargets(IMPORT_FIELDS.companies_contacts), ...custom('company.', defs.get('COMPANY')), ...custom('contact.', defs.get('CONTACT'))];
    }
    const own = IMPORT_FIELDS[entity].map((value) => ({ value, aliases: entity === 'companies' && value === 'name' ? IMPORT_FIELD_ALIASES.name!.filter((a) => a !== 'name').concat('name') : IMPORT_FIELD_ALIASES[value] }));
    return [...own, ...custom('', defs.get(ENTITY_KEY[entity]))];
  }

  private async resolveColumns(
    tx: TenantTx,
    auth: AuthContext,
    req: ImportRequest,
    header: string[],
    rows: string[][],
    defs: Map<FieldEntity, CustomFieldDef[]>,
  ): Promise<{ columns: Column[]; newFields: ImportNewField[]; mapping: Record<string, string> }> {
    const targets = this.targets(req.entity, defs);
    const known = new Set(targets.map((t) => t.value));
    const mapping: Record<string, string> = {};
    for (const [column, target] of Object.entries(req.mapping)) {
      if (!header.includes(column)) throw invalid(`mapping.${column}`, 'is not a column in the file');
      mapping[column] = target;
    }
    const valuesOf = (heading: string) => {
      const i = header.indexOf(heading);
      return rows.map((r) => (r[i] ?? '').trim()).filter(Boolean);
    };
    const canAddFields = auth.permissions.includes('crm:configure');
    if (req.autoMap) {
      // Columns the request leaves out are matched by heading; an explicit "" keeps a column out.
      const open = header.filter((h) => h && !(h in mapping) && header.indexOf(h) === header.lastIndexOf(h));
      const taken = new Set(Object.values(mapping));
      Object.assign(mapping, suggestMapping(open, targets.filter((t) => !taken.has(t.value))));
      for (const h of open) {
        if (h in mapping || !canAddFields || valuesOf(h).length === 0) continue;
        mapping[h] = req.entity === 'companies_contacts' ? `new:${headingSide(h)}` : 'new';
      }
    }

    const columns: Column[] = [];
    const newFields: ImportNewField[] = [];
    const used = new Set<string>();
    const keys = new Map<FieldEntity, Set<string>>();
    for (const [heading, target] of Object.entries(mapping)) {
      if (!target) continue;
      const index = header.indexOf(heading);
      if ((NEW_FIELD_TARGETS as readonly string[]).includes(target)) {
        const side: Side | undefined = target === 'new' ? undefined : (target.slice(4) as Side);
        if (req.entity === 'companies_contacts' ? !side : !!side) throw invalid(`mapping.${heading}`, `cannot map to "${target}"`);
        if (!canAddFields) {
          throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only people who can configure the CRM can add fields. Choose an existing field or leave the column out.', details: [{ path: `mapping.${heading}`, message: 'crm:configure' }] });
        }
        const entity = side ? SIDE_ENTITY[side] : ENTITY_KEY[req.entity as keyof typeof ENTITY_KEY];
        const label = customFieldLabelFor(heading) || heading;
        const prefix = side ? `${side}.` : '';
        // A field with this name already exists (perhaps switched off by the matcher's rules): use it.
        const same = defs.get(entity)!.find((d) => d.label.toLowerCase() === label.toLowerCase());
        if (same) {
          columns.push({ index, heading, target: `${prefix}customFields.${same.key}` });
          continue;
        }
        if (!keys.has(entity)) keys.set(entity, await this.fields.takenKeys(tx, auth.tenantId, entity));
        const key = customFieldKeyFor(heading, keys.get(entity)!);
        keys.get(entity)!.add(key);
        const values = valuesOf(heading);
        const type = values.length > 0 && values.every((v) => /^-?\d+(\.\d+)?$/.test(v)) ? 'NUMBER' : 'TEXT';
        const long = values.find((v) => v.length > CUSTOM_FIELD_LIMITS.text);
        if (long) throw invalid(`mapping.${heading}`, `Some values are longer than ${CUSTOM_FIELD_LIMITS.text.toLocaleString('en-US')} characters. Add a long text field for this column in Settings first.`);
        newFields.push({ column: heading, entity, key, label, type });
        columns.push({ index, heading, target: `${prefix}customFields.${key}` });
        continue;
      }
      if (!known.has(target) && !(CF.test(target) && matchesEntity(req.entity, target))) throw invalid(`mapping.${heading}`, `cannot map to "${target}"`);
      if (CF.test(target)) {
        const m = CF.exec(target)!;
        const entity = m[1] ? SIDE_ENTITY[m[1] as Side] : ENTITY_KEY[req.entity as keyof typeof ENTITY_KEY];
        if (!defs.get(entity)!.some((d) => d.key === m[2])) throw invalid(`mapping.${heading}`, `cannot map to "${target}"`);
      }
      columns.push({ index, heading, target });
    }
    for (const c of columns) {
      if (used.has(c.target)) throw invalid(`mapping.${c.heading}`, 'Two columns are matched to the same field. Match one of them to another field.');
      used.add(c.target);
    }
    const required = REQUIRED[req.entity];
    if (!columns.some((c) => required.any.includes(c.target))) throw invalid('mapping', `Map a column to ${required.label}.`);
    const shown = Object.fromEntries(columns.map((c) => [c.heading, c.target]));
    for (const h of header) if (h && !(h in shown)) shown[h] = '';
    return { columns, newFields, mapping: Object.fromEntries(Object.entries(mapping).map(([h, t]) => [h, (NEW_FIELD_TARGETS as readonly string[]).includes(t) ? t : (shown[h] ?? t)])) };
  }

  // ───────────── Leads, contacts or companies ─────────────

  private async importSingle(
    tx: TenantTx,
    auth: AuthContext,
    req: ImportRequest,
    rows: { cells: string[]; row: number }[],
    read: (cells: string[], side?: Side) => Values,
    defs: CustomFieldDef[],
    result: ImportResult,
  ): Promise<void> {
    const entity = req.entity as Exclude<ImportEntity, 'companies_contacts'>;
    const fieldEntity = ENTITY_KEY[entity];
    const prepared: { row: number; data: Record<string, unknown>; companyName: string | null; dupKeys: string[] }[] = [];
    for (const { cells, row } of rows) {
      const { raw, custom } = read(cells);
      const input: Record<string, unknown> = { ...raw };
      const problems: string[] = [];
      if (entity === 'leads') {
        if (raw.tags !== undefined) input.tags = raw.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean);
        if (raw.status !== undefined) input.status = raw.status.toUpperCase();
      }
      if (entity === 'contacts') nameParts(input);
      if (entity === 'companies') websiteParts(input);
      country(input, problems);
      let companyName: string | null = null;
      if (entity === 'contacts') {
        companyName = raw.companyName || null;
        delete input.companyName;
      }
      const parsed = (entity === 'leads' ? leadInputSchema : entity === 'contacts' ? contactInputSchema : companyInputSchema).safeParse(input);
      if (!parsed.success) problems.push(...issues(parsed.error.issues));
      if (problems.length) {
        result.errors.push({ row, message: problems.join('; ') });
        continue;
      }
      let customFields: Record<string, unknown> | undefined;
      try {
        customFields = await this.fields.validate(tx, auth.tenantId, fieldEntity, custom, undefined, defs);
      } catch (err) {
        result.errors.push({ row, message: describeValidation(err) });
        continue;
      }
      const data = { ...(parsed.data as Record<string, unknown>), customFields: customFields ?? {} };
      prepared.push({ row, data, companyName, dupKeys: dupKeys(entity, data) });
    }

    const existing = await this.existingKeys(tx, auth.tenantId, entity, prepared.flatMap((p) => p.dupKeys));
    const toCreate = prepared.filter((p) => {
      const isDup = p.dupKeys.some((k) => existing.has(k));
      if (isDup && req.duplicateStrategy === 'skip') {
        result.skippedDuplicates++;
        return false;
      }
      p.dupKeys.forEach((k) => existing.add(k)); // later rows in the same file count as duplicates too
      return true;
    });
    result.created = toCreate.length;
    if (req.dryRun || toCreate.length === 0) return;

    if (entity === 'leads') {
      await chunks(toCreate, (batch) =>
        tx.lead.createMany({ data: batch.map((p) => ({ tenantId: auth.tenantId, ownerId: auth.userId, ...(p.data as object), tags: (p.data.tags as string[]) ?? [] }) as Prisma.LeadCreateManyInput) }),
      );
    } else if (entity === 'companies') {
      await this.createCompanies(tx, auth, toCreate.map((p) => ({ id: randomUUID(), data: p.data })));
    } else {
      const companyIds = await this.resolveCompanies(tx, auth, toCreate.map((p) => p.companyName).filter((n): n is string => !!n));
      const statusId = await defaultStatusId(tx, auth.tenantId, 'EMPLOYEE');
      const fresh = await this.cadence.freshStageId(tx, auth.tenantId);
      await chunks(toCreate, (batch) =>
        tx.contact.createMany({
          data: batch.map((p) => contactRow(auth, statusId, p.data, p.companyName ? (companyIds.get(nameKey(p.companyName)) ?? null) : null, auth.userId, fresh)),
        }),
      );
    }
  }

  // ───────────── A company and an employee per row ─────────────

  private async importCombined(
    tx: TenantTx,
    auth: AuthContext,
    req: ImportRequest,
    rows: { cells: string[]; row: number }[],
    read: (cells: string[], side?: Side) => Values,
    defs: Map<FieldEntity, CustomFieldDef[]>,
    result: ImportResult,
  ): Promise<void> {
    interface Prepared {
      row: number;
      companyKey: string;
      company: Record<string, unknown>;
      contact: Record<string, unknown> | null;
      contactKeys: string[];
    }
    const prepared: Prepared[] = [];
    for (const { cells, row } of rows) {
      const co = read(cells, 'company');
      const ct = read(cells, 'contact');
      const problems: string[] = [];
      const companyInput: Record<string, unknown> = { ...co.raw };
      websiteParts(companyInput);
      country(companyInput, problems, 'Company');
      const company = companyInputSchema.safeParse(companyInput);
      if (!company.success) problems.push(...issues(company.error.issues, 'Company'));

      const hasContact = Object.keys(ct.raw).length > 0 || Object.keys(ct.custom).length > 0;
      let contact: ReturnType<typeof contactInputSchema.safeParse> | null = null;
      if (hasContact) {
        const contactInput: Record<string, unknown> = { ...ct.raw };
        nameParts(contactInput);
        // A row with an email but no name still gets its employee, named after the address ("priya.nair@…" → Priya Nair).
        if (!contactInput.firstName && typeof contactInput.email === 'string') Object.assign(contactInput, nameFromEmail(contactInput.email));
        country(contactInput, problems, 'Employee');
        contact = contactInputSchema.safeParse(contactInput);
        if (!contact.success) problems.push(...issues(contact.error.issues, 'Employee'));
      }
      if (problems.length) {
        result.errors.push({ row, message: problems.join('; ') });
        continue;
      }
      let companyCf: Record<string, unknown> | undefined;
      let contactCf: Record<string, unknown> | undefined;
      try {
        // Required custom fields are checked where the record is new; a matched company keeps its own values.
        companyCf = await this.fields.validate(tx, auth.tenantId, 'COMPANY', co.custom, {}, defs.get('COMPANY'));
        if (contact) contactCf = await this.fields.validate(tx, auth.tenantId, 'CONTACT', ct.custom, undefined, defs.get('CONTACT'));
      } catch (err) {
        result.errors.push({ row, message: describeValidation(err) });
        continue;
      }
      const companyData: Record<string, unknown> = { ...(company.success ? (company.data as Record<string, unknown>) : {}), customFields: companyCf ?? {} };
      const contactData: Record<string, unknown> | null = contact?.success ? { ...(contact.data as Record<string, unknown>), customFields: contactCf ?? {} } : null;
      prepared.push({
        row,
        companyKey: nameKey(companyData.name as string),
        company: companyData,
        contact: contactData,
        contactKeys: contactData ? matchKeys({ emails: [contactData.email as string | null], phones: [contactData.phone as string | null], linkedin: [contactData.linkedinUrl as string | null] }) : [],
      });
    }

    // Companies: rows with the same name are one company; an existing company with that name or website is reused.
    const groups = new Map<string, { data: Record<string, unknown>; rows: Prepared[] }>();
    for (const p of prepared) {
      const g = groups.get(p.companyKey);
      if (g) {
        g.rows.push(p);
        fillBlanks(g.data, p.company);
      } else groups.set(p.companyKey, { data: { ...p.company, customFields: { ...(p.company.customFields as object) } }, rows: [p] });
    }
    const v = await visibility(tx, auth);
    const matched = await this.matchCompanies(tx, auth, v, [...groups.entries()].map(([key, g]) => ({ key, website: g.data.website as string | null })));
    // Required company custom fields apply to the companies this import creates.
    const missing: { row: number; message: string }[] = [];
    for (const [key, g] of groups) {
      if (matched.has(key)) continue;
      try {
        await this.fields.validate(tx, auth.tenantId, 'COMPANY', g.data.customFields as Record<string, unknown>, undefined, defs.get('COMPANY'));
      } catch (err) {
        const message = describeValidation(err);
        for (const p of g.rows) missing.push({ row: p.row, message });
        groups.delete(key);
      }
    }
    result.errors.push(...missing);
    result.errors.sort((a, b) => a.row - b.row);

    // Employees: the same email, phone or LinkedIn profile as an existing employee is a duplicate.
    const existing = await this.existingContactKeys(tx, auth.tenantId, [...groups.values()].flatMap((g) => g.rows.flatMap((p) => p.contactKeys)));
    let rowsImported = 0;
    let contactsToCreate = 0;
    const contactRows: { companyKey: string; data: Record<string, unknown> }[] = [];
    for (const [key, g] of groups) {
      for (const p of g.rows) {
        if (p.contact) {
          if (p.contactKeys.some((k) => existing.has(k)) && req.duplicateStrategy === 'skip') {
            result.skippedDuplicates++;
            continue;
          }
          p.contactKeys.forEach((k) => existing.add(k));
          contactsToCreate++;
          contactRows.push({ companyKey: key, data: p.contact });
        }
        rowsImported++;
      }
    }
    // Companies that only appear in skipped rows are still created or updated: their rows' other details count.
    result.created = rowsImported;
    result.companiesMatched = [...groups.keys()].filter((k) => matched.has(k)).length;
    result.companiesCreated = groups.size - result.companiesMatched;
    result.contactsCreated = contactsToCreate;
    if (req.dryRun) return;

    // Create the new companies, and fill what matched companies leave blank.
    const ids = new Map<string, { id: string; ownerId: string | null }>();
    const fresh: { id: string; data: Record<string, unknown> }[] = [];
    for (const [key, g] of groups) {
      const m = matched.get(key);
      if (m) {
        ids.set(key, { id: m.id, ownerId: m.ownerId });
        if (canSeeDetails(v, m.ownerId)) await this.fillCompany(tx, auth, m.id, g.data, defs.get('COMPANY')!);
      } else {
        const id = randomUUID();
        fresh.push({ id, data: g.data });
        ids.set(key, { id, ownerId: auth.userId });
      }
    }
    await this.createCompanies(tx, auth, fresh);
    const statusId = await defaultStatusId(tx, auth.tenantId, 'EMPLOYEE');
    const freshStage = await this.cadence.freshStageId(tx, auth.tenantId);
    await chunks(contactRows, (batch) =>
      tx.contact.createMany({ data: batch.map((c) => contactRow(auth, statusId, c.data, ids.get(c.companyKey)!.id, ids.get(c.companyKey)!.ownerId ?? auth.userId, freshStage)) }),
    );
  }

  /** Existing companies, visible to the importer, with one of these names or websites. The oldest wins. */
  private async matchCompanies(tx: TenantTx, auth: AuthContext, v: Awaited<ReturnType<typeof visibility>>, wanted: { key: string; website: string | null }[]) {
    const out = new Map<string, { id: string; ownerId: string | null }>();
    const scope = { tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) };
    for (const part of slices(wanted)) {
      const rows = await tx.company.findMany({ where: { ...scope, nameKey: { in: part.map((w) => w.key) } }, select: { id: true, ownerId: true, nameKey: true }, orderBy: { createdAt: 'asc' } });
      for (const r of rows) if (r.nameKey && !out.has(r.nameKey)) out.set(r.nameKey, { id: r.id, ownerId: r.ownerId });
    }
    const byDomain = wanted.filter((w) => !out.has(w.key) && w.website).map((w) => ({ key: w.key, keys: matchKeys({ websites: [w.website] }) })).filter((w) => w.keys.length);
    for (const part of slices(byDomain)) {
      const rows = await tx.company.findMany({ where: { ...scope, matchKeys: { hasSome: part.flatMap((w) => w.keys) } }, select: { id: true, ownerId: true, matchKeys: true }, orderBy: { createdAt: 'asc' } });
      for (const w of part) {
        const r = rows.find((x) => x.matchKeys.some((k) => w.keys.includes(k)));
        if (r && !out.has(w.key)) out.set(w.key, { id: r.id, ownerId: r.ownerId });
      }
    }
    return out;
  }

  /** Writes what an existing company leaves empty; nothing it already holds is changed. */
  private async fillCompany(tx: TenantTx, auth: AuthContext, id: string, data: Record<string, unknown>, defs: CustomFieldDef[]): Promise<void> {
    const before = await tx.company.findUniqueOrThrow({ where: { id } });
    const patch: Record<string, unknown> = {};
    for (const [k, value] of Object.entries(data)) {
      if (k === 'name' || k === 'customFields' || value === null || value === undefined || value === '') continue;
      const old = (before as Record<string, unknown>)[k];
      if (old === null || old === undefined || old === '') patch[k] = value;
    }
    const oldCf = (before.customFields ?? {}) as Record<string, unknown>;
    const newCf = Object.fromEntries(Object.entries(data.customFields as Record<string, unknown>).filter(([k]) => oldCf[k] === undefined || oldCf[k] === null || oldCf[k] === ''));
    if (!Object.keys(patch).length && !Object.keys(newCf).length) return;
    if (patch.website) patch.websites = [{ value: patch.website, label: null, primary: true }, ...points(before.websites)];
    if (patch.linkedinUrl) patch.linkedinUrls = [{ value: patch.linkedinUrl, label: null, primary: true }, ...points(before.linkedinUrls)];
    if (patch.primaryEmail) patch.emails = [{ value: patch.primaryEmail, label: null, primary: true }, ...points(before.emails)];
    if (patch.primaryPhone) patch.phones = [{ value: patch.primaryPhone, label: null, primary: true }, ...points(before.phones)];
    const merged = { ...before, ...patch } as Record<string, unknown>;
    const customFields = Object.keys(newCf).length ? await this.fields.validate(tx, auth.tenantId, 'COMPANY', newCf, oldCf, defs) : undefined;
    await tx.company.update({
      where: { id },
      data: {
        ...(patch as Prisma.CompanyUncheckedUpdateInput),
        ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
        matchKeys: companyKeys(merged),
        updatedById: auth.userId,
      },
    });
  }

  /** New companies with their lead numbers, assigned manager and first ownership entry, like the lead form makes them. */
  private async createCompanies(tx: TenantTx, auth: AuthContext, list: { id: string; data: Record<string, unknown> }[]): Promise<void> {
    if (!list.length) return;
    const statusId = await defaultStatusId(tx, auth.tenantId, 'COMPANY');
    const managerId = await reportingManagerOf(tx, auth.tenantId, auth.userId);
    const now = new Date();
    await chunks(list, (batch) =>
      tx.company.createMany({
        data: batch.map(({ id, data }) => {
          const row: Record<string, unknown> = {
            ...data, id, tenantId: auth.tenantId, ownerId: auth.userId, managerId, createdById: auth.userId, updatedById: auth.userId,
            statusId, statusChangedAt: now, statusChangedById: auth.userId,
            websites: data.website ? [{ value: data.website, label: null, primary: true }] : [],
            linkedinUrls: data.linkedinUrl ? [{ value: data.linkedinUrl, label: null, primary: true }] : [],
            emails: data.primaryEmail ? [{ value: data.primaryEmail, label: null, primary: true }] : [],
            phones: data.primaryPhone ? [{ value: data.primaryPhone, label: null, primary: true }] : [],
          };
          return { ...row, nameKey: companyNameKey(data.name as string), matchKeys: companyKeys(row) } as Prisma.CompanyCreateManyInput;
        }),
      }),
    );
    await chunks(list, (batch) =>
      tx.leadOwnerChange.createMany({ data: batch.map(({ id }) => ({ tenantId: auth.tenantId, companyId: id, fromUserId: null, toUserId: auth.userId, byUserId: auth.userId, reason: null, note: null })) }),
    );
    while ((await assignLeadNumbers(tx, auth.tenantId)) > 0);
    // Imported companies get their missing details filled from public sources too, spaced out (ADR 0076).
    await this.enrichment.queueImportIn(
      tx,
      auth.tenantId,
      list.map(({ id, data }) => ({ id, name: String(data.name ?? ''), domain: (data.domain as string | undefined) ?? (data.website ? hostOf(String(data.website)) : null) })),
      auth.userId,
    );
  }

  /** Contacts' company column: matches company names (ignoring case and legal suffixes), creating the ones that do not exist. */
  private async resolveCompanies(tx: TenantTx, auth: AuthContext, names: string[]): Promise<Map<string, string>> {
    const unique = [...new Map(names.map((n) => [nameKey(n), n])).entries()];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    for (const part of slices(unique)) {
      const rows = await tx.company.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, nameKey: { in: part.map(([k]) => k) } }, select: { id: true, nameKey: true }, orderBy: { createdAt: 'asc' } });
      rows.forEach((r) => r.nameKey && !map.has(r.nameKey) && map.set(r.nameKey, r.id));
    }
    const fresh = unique.filter(([k]) => !map.has(k)).map(([k, name]) => ({ key: k, id: randomUUID(), data: { name: name.slice(0, 200), customFields: {} } }));
    await this.createCompanies(tx, auth, fresh);
    fresh.forEach((f) => map.set(f.key, f.id));
    return map;
  }

  private async existingKeys(tx: TenantTx, tenantId: string, entity: Exclude<ImportEntity, 'companies_contacts'>, keys: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    if (entity === 'contacts') {
      const wanted = keys.filter((k) => k.startsWith('mk:')).map((k) => k.slice(3));
      for (const k of await this.existingContactKeys(tx, tenantId, wanted)) found.add(`mk:${k}`);
      return found;
    }
    if (entity === 'companies') {
      const names = keys.filter((k) => k.startsWith('name:')).map((k) => k.slice(5));
      const others = keys.filter((k) => k.startsWith('mk:')).map((k) => k.slice(3));
      for (const part of slices(names)) {
        const rows = await tx.company.findMany({ where: { tenantId, deletedAt: null, nameKey: { in: part } }, select: { nameKey: true } });
        rows.forEach((r) => r.nameKey && found.add(`name:${r.nameKey}`));
      }
      for (const part of slices(others)) {
        const rows = await tx.company.findMany({ where: { tenantId, deletedAt: null, matchKeys: { hasSome: part } }, select: { matchKeys: true } });
        rows.forEach((r) => r.matchKeys.forEach((k) => found.add(`mk:${k}`)));
      }
      return found;
    }
    const emails = keys.filter((k) => k.startsWith('email:')).map((k) => k.slice(6));
    const phones = keys.filter((k) => k.startsWith('phone:')).map((k) => k.slice(6));
    for (const part of slices(emails)) {
      const rows = await tx.lead.findMany({ where: { tenantId, deletedAt: null, email: { in: part, mode: 'insensitive' } }, select: { email: true } });
      rows.forEach((r) => r.email && found.add(`email:${r.email.toLowerCase()}`));
    }
    for (const part of slices(phones)) {
      const rows = await tx.lead.findMany({ where: { tenantId, deletedAt: null, phoneDigits: { in: part } }, select: { phoneDigits: true } });
      rows.forEach((r) => r.phoneDigits && found.add(`phone:${r.phoneDigits}`));
    }
    return found;
  }

  private async existingContactKeys(tx: TenantTx, tenantId: string, keys: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    const unique = [...new Set(keys)];
    for (const part of slices(unique)) {
      const rows = await tx.contact.findMany({ where: { tenantId, deletedAt: null, matchKeys: { hasSome: part } }, select: { matchKeys: true } });
      rows.forEach((r) => r.matchKeys.forEach((k) => part.includes(k) && found.add(k)));
    }
    return found;
  }
}

// ───────────── Helpers ─────────────

/** A definition for a field the import is about to add, so rows can be checked against it before it exists. */
function syntheticDef(f: ImportNewField): CustomFieldDef {
  return {
    id: `new:${f.key}`, entity: f.entity, key: f.key, label: f.label, description: null, type: f.type, options: [], required: false, defaultValue: null, currency: null,
    viewDesignationIds: [], editDesignationIds: [], showInForms: true, searchable: f.type === 'TEXT', active: true, position: 0, showWhen: null, formula: null, decimals: null,
    access: { view: true, edit: true },
  };
}

function matchesEntity(entity: ImportEntity, target: string): boolean {
  const side = CF.exec(target)?.[1];
  return entity === 'companies_contacts' ? !!side : !side;
}

const nameKey = (name: string): string => companyNameKey(name) ?? name.trim().toLowerCase();

/** "Priya Nair" in a full-name column becomes first and last name, unless those have their own columns. */
function nameParts(input: Record<string, unknown>): void {
  const full = typeof input.fullName === 'string' ? input.fullName.trim().replace(/\s+/g, ' ') : '';
  delete input.fullName;
  if (!full) return;
  const [first, ...rest] = full.split(' ');
  if (!input.firstName) input.firstName = first;
  if (!input.lastName && rest.length) input.lastName = rest.join(' ');
}

function nameFromEmail(email: string): { firstName: string; lastName?: string } {
  const words = (email.split('@')[0] ?? '').split(/[._-]+/).filter((w) => /[a-z]/i.test(w)).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.length ? { firstName: words[0]!, ...(words.length > 1 ? { lastName: words.slice(1).join(' ') } : {}) } : { firstName: email };
}

/** The domain follows the website when the file has no domain column. */
function websiteParts(input: Record<string, unknown>): void {
  if (typeof input.website === 'string' && !input.domain) {
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.website) ? input.website : `https://${input.website}`);
      input.domain = url.hostname.replace(/^www\./, '');
    } catch {
      // The schema reports the bad address.
    }
  }
}

/** Country names and abbreviations become two-letter codes ("United States of America (USA)" → US). */
function country(input: Record<string, unknown>, problems: string[], record?: string): void {
  if (typeof input.country !== 'string' || !input.country) return;
  const code = countryCodeFrom(input.country);
  if (code) input.country = code;
  else problems.push(`${record ? `${tr(record)} ` : ''}country: ${tr('"{value}" is not a country we recognise', { value: input.country })}`);
}

function issues(list: { path: (string | number)[]; message: string }[], record?: string): string[] {
  return list.map((e) => `${record ? `${tr(record)} ` : ''}${e.path.join('.') || 'row'}: ${localize(e.message)}`);
}

function fillBlanks(target: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(from)) {
    if (k === 'customFields') {
      const cf = target.customFields as Record<string, unknown>;
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) if (cf[ck] === undefined) cf[ck] = cv;
    } else if ((target[k] === undefined || target[k] === null || target[k] === '') && v !== null && v !== undefined) target[k] = v;
  }
}

const points = (v: unknown): { value: string; label: string | null; primary: boolean }[] =>
  (Array.isArray(v) ? (v as { value: string; label?: string | null }[]) : []).map((p) => ({ value: p.value, label: p.label ?? null, primary: false }));

function companyKeys(row: Record<string, unknown>): string[] {
  const list = (v: unknown) => points(v).map((p) => p.value);
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return matchKeys({
    websites: [s(row.website), s(row.domain), ...list(row.websites)],
    emails: [s(row.primaryEmail), ...list(row.emails)],
    phones: [s(row.primaryPhone), ...list(row.phones)],
    linkedin: [s(row.linkedinUrl), ...list(row.linkedinUrls)],
    emailDomains: true,
  });
}

function contactRow(auth: AuthContext, statusId: string | null, data: Record<string, unknown>, companyId: string | null, ownerId: string, freshStageId: string | null = null): Prisma.ContactCreateManyInput {
  const now = new Date();
  return {
    ...(data as object),
    // A company's employees start in Fresh Email Pending (ADR 0083).
    ...(companyId && freshStageId ? { stageId: freshStageId, stageChangedAt: now, stageChangedById: auth.userId } : {}),
    email: typeof data.email === 'string' ? data.email.toLowerCase() : (data.email as string | null | undefined),
    nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt as string) : null,
    tenantId: auth.tenantId, ownerId, companyId, statusId, statusChangedAt: now, statusChangedById: auth.userId, createdById: auth.userId, updatedById: auth.userId,
    customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
  } as Prisma.ContactCreateManyInput;
}

function dupKeys(entity: Exclude<ImportEntity, 'companies_contacts'>, data: Record<string, unknown>): string[] {
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  if (entity === 'companies') {
    const keys = typeof data.name === 'string' ? [`name:${nameKey(data.name)}`] : [];
    return [...keys, ...matchKeys({ websites: [s(data.website), s(data.domain)] }).map((k) => `mk:${k}`)];
  }
  if (entity === 'contacts') return matchKeys({ emails: [s(data.email)], phones: [s(data.phone)], linkedin: [s(data.linkedinUrl)] }).map((k) => `mk:${k}`);
  const keys: string[] = [];
  if (typeof data.email === 'string') keys.push(`email:${data.email.toLowerCase()}`);
  const digits = phoneDigits(data.phone as string | null);
  if (digits) keys.push(`phone:${digits}`);
  return keys;
}

async function chunks<T>(items: T[], fn: (batch: T[]) => Promise<unknown>, size = 500): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Batches keep each database filter small. */
const slices = <T>(xs: T[], n = 200): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

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

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
