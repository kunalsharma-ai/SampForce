import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  CHOICE_FIELD_TYPES,
  conditionLoop,
  CUSTOM_FIELD_LIMITS,
  type CustomFieldDef,
  type CustomFieldDefInput,
  type CustomFieldEntity,
  type CustomFieldFile,
  type CustomFieldFilter,
  type CustomFieldType,
  type CustomFieldUpdate,
  customFieldFilterSchema,
  filterOpsFor,
  FORMULA_INPUT_TYPES,
  formulaLoop,
  isAdvancedField,
  parseFormula,
  resolveFields,
  SEARCHABLE_FIELD_TYPES,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { featureNotIncluded, hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { checkFile } from '../portal/portal.service';
import { notFound } from './crm-helpers';
import { canSeeDetails, companyScope, contactScope, leadScope, visibility } from './visibility';

type Entity = CustomFieldEntity;
type Row = Prisma.CustomFieldGetPayload<object>;

/** Who is asking: their designation and whether they configure the CRM (administrators see and edit every field). */
export interface FieldViewer {
  designationId: string | null;
  admin: boolean;
}

/** A raw MongoDB field path for a custom field value. */
export const cfPath = (key: string) => `custom_fields.${key}`;

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Definitions ─────────────

  list(auth: AuthContext, entity?: Entity, includeInactive = false): Promise<CustomFieldDef[]> {
    return this.prisma.run(auth, async (tx) => {
      const viewer = await this.viewer(tx, auth);
      const rows = await this.rows(tx, auth.tenantId, entity, includeInactive && viewer.admin);
      return rows.map((r) => toDef(r, viewer)).filter((d) => viewer.admin || d.access.view);
    });
  }

  /** Active definitions (for import, export and the legacy callers that have no person). */
  async definitions(tx: TenantTx, tenantId: string, entity?: Entity): Promise<CustomFieldDef[]> {
    return (await this.rows(tx, tenantId, entity, false)).map((r) => toDef(r, { designationId: null, admin: true }));
  }

  private rows(tx: TenantTx, tenantId: string, entity: Entity | undefined, includeInactive: boolean): Promise<Row[]> {
    return tx.customField.findMany({
      where: { tenantId, archivedAt: null, ...(entity ? { entity } : {}), ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ entity: 'asc' }, { position: 'asc' }],
    });
  }

  async viewer(tx: TenantTx, auth: AuthContext): Promise<FieldViewer> {
    // Workflows and other system readers load records without a membership: they see every field.
    if (!auth.membershipId || !Array.isArray(auth.permissions)) return { designationId: null, admin: true };
    const m = await tx.membership.findFirst({ where: { id: auth.membershipId, tenantId: auth.tenantId }, select: { designationId: true } });
    return { designationId: m?.designationId ?? null, admin: auth.permissions.includes('crm:configure') };
  }

  /** The caller's view of one entity's active fields. */
  async accessFor(tx: TenantTx, auth: AuthContext, entity: Entity): Promise<{ defs: CustomFieldDef[]; viewer: FieldViewer }> {
    const viewer = await this.viewer(tx, auth);
    return { defs: (await this.rows(tx, auth.tenantId, entity, false)).map((r) => toDef(r, viewer)), viewer };
  }

  create(auth: AuthContext, input: CustomFieldDefInput, meta: RequestMeta): Promise<CustomFieldDef> {
    return this.prisma.run(auth, async (tx) => {
      await this.checkPlan(tx, auth.tenantId, input);
      const count = await tx.customField.count({ where: { tenantId: auth.tenantId, entity: input.entity, archivedAt: null } });
      if (count >= CUSTOM_FIELD_LIMITS.perEntity) throw new BadRequestException({ code: 'LIMIT_REACHED', message: 'A record type can have up to 100 custom fields.' });
      await this.checkDesignations(tx, auth.tenantId, [...input.viewDesignationIds, ...input.editDesignationIds]);
      const formula = input.type === 'FORMULA';
      const defaultValue = formula ? null : this.checkDefault(input.type, input.options, input.currency ?? null, input.defaultValue);
      const siblings = await this.definitions(tx, auth.tenantId, input.entity);
      const showWhen = this.checkCondition(siblings, input.key, input.showWhen ?? null);
      const expression = formula ? this.checkFormula(siblings, input.key, input.formula ?? '') : null;
      const archived = await tx.customField.findFirst({ where: { tenantId: auth.tenantId, entity: input.entity, key: input.key, archivedAt: { not: null } }, select: { id: true } });
      if (archived) throw new ConflictException({ code: 'DUPLICATE_KEY', message: 'A deleted field used this key. Pick another key, so old values never mix with new ones.' });
      try {
        const def = await tx.customField.create({
          data: {
            tenantId: auth.tenantId, entity: input.entity, key: input.key, label: input.label, description: input.description ?? null, type: input.type,
            options: CHOICE_FIELD_TYPES.includes(input.type) ? input.options : [], required: input.required && !formula, defaultValue: defaultValue as Prisma.InputJsonValue,
            currency: input.type === 'CURRENCY' || formula ? (input.currency ?? null) : null, viewDesignationIds: input.viewDesignationIds, editDesignationIds: input.editDesignationIds,
            showInForms: input.showInForms, searchable: input.searchable && SEARCHABLE_FIELD_TYPES.includes(input.type), active: input.active, position: count,
            showWhen: (showWhen ?? null) as Prisma.InputJsonValue, formula: expression, decimals: formula ? (input.decimals ?? 2) : null,
          },
        });
        await this.refresh(tx, auth.tenantId, input.entity);
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'custom_field.created', entityType: 'custom_field', entityId: def.id,
          metadata: { entity: def.entity, key: def.key, type: def.type }, meta,
        });
        return toDef(def, await this.viewer(tx, auth));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException({ code: 'DUPLICATE_KEY', message: 'A field with this key already exists.' });
        }
        throw err;
      }
    });
  }

  /** Every key a record type has used, deleted fields included, so a new field never takes an old field's values. */
  async takenKeys(tx: TenantTx, tenantId: string, entity: Entity): Promise<Set<string>> {
    const rows = await tx.customField.findMany({ where: { tenantId, entity }, select: { key: true } });
    return new Set(rows.map((r) => r.key));
  }

  /**
   * Fields an import adds for columns no existing field matched (ADR 0066): plain text or number fields, shown in
   * forms, searchable when text, open to every designation. The caller has checked `crm:configure`.
   */
  async createForImport(tx: TenantTx, auth: AuthContext, fields: { entity: 'COMPANY' | 'CONTACT' | 'LEAD'; key: string; label: string; type: 'TEXT' | 'NUMBER' }[], meta: RequestMeta): Promise<void> {
    for (const entity of new Set(fields.map((f) => f.entity))) {
      const adding = fields.filter((f) => f.entity === entity);
      let position = await tx.customField.count({ where: { tenantId: auth.tenantId, entity, archivedAt: null } });
      if (position + adding.length > CUSTOM_FIELD_LIMITS.perEntity) {
        throw new BadRequestException({ code: 'LIMIT_REACHED', message: 'A record type can have up to 100 custom fields.', details: adding.map((f) => ({ path: `mapping.${f.label}`, message: 'A record type can have up to 100 custom fields.' })) });
      }
      for (const f of adding) {
        const def = await tx.customField.create({
          data: {
            tenantId: auth.tenantId, entity, key: f.key, label: f.label, description: null, type: f.type, options: [], required: false,
            currency: null, viewDesignationIds: [], editDesignationIds: [], showInForms: true, searchable: f.type === 'TEXT', active: true, position: position++,
            formula: null, decimals: null,
          },
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'custom_field.created', entityType: 'custom_field', entityId: def.id,
          metadata: { entity, key: f.key, type: f.type, source: 'import' }, meta,
        });
      }
    }
  }

  update(auth: AuthContext, id: string, input: CustomFieldUpdate, meta: RequestMeta): Promise<CustomFieldDef> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.customField.findFirst({ where: { id, tenantId: auth.tenantId, archivedAt: null } });
      if (!before) throw notFound('Custom field');
      const type = before.type as CustomFieldType;
      const options = input.options ?? before.options;
      if (CHOICE_FIELD_TYPES.includes(type) && options.length === 0) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'options', message: 'Add at least one option' }] });
      }
      const next = { entity: before.entity as Entity, type, viewDesignationIds: input.viewDesignationIds ?? before.viewDesignationIds, editDesignationIds: input.editDesignationIds ?? before.editDesignationIds };
      if (isAdvancedField(next) && !isAdvancedField({ ...next, viewDesignationIds: before.viewDesignationIds, editDesignationIds: before.editDesignationIds })) await this.checkPlan(tx, auth.tenantId, next);
      await this.checkDesignations(tx, auth.tenantId, [...(input.viewDesignationIds ?? []), ...(input.editDesignationIds ?? [])]);
      const currency = input.currency !== undefined ? input.currency : before.currency;
      const formula = type === 'FORMULA';
      const defaultValue = input.defaultValue !== undefined && !formula ? this.checkDefault(type, options, currency, input.defaultValue) : undefined;
      const siblings = input.showWhen !== undefined || input.formula !== undefined ? await this.definitions(tx, auth.tenantId, before.entity as Entity) : [];
      const showWhen = input.showWhen !== undefined ? this.checkCondition(siblings, before.key, input.showWhen) : undefined;
      if (showWhen && !before.showWhen) await this.checkPlan(tx, auth.tenantId, { ...next, showWhen });
      const expression = formula && input.formula !== undefined ? this.checkFormula(siblings, before.key, input.formula ?? '') : undefined;
      const row = await tx.customField.update({
        where: { id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.options !== undefined && CHOICE_FIELD_TYPES.includes(type) ? { options: input.options } : {}),
          ...(input.required !== undefined ? { required: input.required } : {}),
          ...(defaultValue !== undefined ? { defaultValue: (defaultValue ?? null) as Prisma.InputJsonValue } : {}),
          ...(input.currency !== undefined && (type === 'CURRENCY' || formula) ? { currency: input.currency } : {}),
          ...(showWhen !== undefined ? { showWhen: (showWhen ?? null) as Prisma.InputJsonValue } : {}),
          ...(expression !== undefined ? { formula: expression } : {}),
          ...(input.decimals !== undefined && formula ? { decimals: input.decimals ?? 2 } : {}),
          ...(formula ? { required: false } : {}),
          ...(input.viewDesignationIds !== undefined ? { viewDesignationIds: input.viewDesignationIds } : {}),
          ...(input.editDesignationIds !== undefined ? { editDesignationIds: input.editDesignationIds } : {}),
          ...(input.showInForms !== undefined ? { showInForms: input.showInForms } : {}),
          ...(input.searchable !== undefined ? { searchable: input.searchable && SEARCHABLE_FIELD_TYPES.includes(type) } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'custom_field.updated', entityType: 'custom_field', entityId: id,
        metadata: { key: before.key, changed: Object.keys(input) }, meta,
      });
      await this.refresh(tx, auth.tenantId, before.entity as Entity);
      return toDef(row, await this.viewer(tx, auth));
    });
  }

  reorder(auth: AuthContext, entity: Entity, ids: string[], meta: RequestMeta): Promise<CustomFieldDef[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.customField.findMany({ where: { tenantId: auth.tenantId, entity, archivedAt: null }, select: { id: true } });
      const known = new Set(rows.map((r) => r.id));
      if (ids.length !== known.size || ids.some((i) => !known.has(i)) || new Set(ids).size !== ids.length) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'List every field of this record type once.', details: [{ path: 'ids', message: 'must list every field once' }] });
      }
      for (const [position, id] of ids.entries()) await tx.customField.update({ where: { id }, data: { position } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'custom_field.reordered', entityType: 'custom_field', metadata: { entity }, meta });
      const viewer = await this.viewer(tx, auth);
      return (await this.rows(tx, auth.tenantId, entity, true)).map((r) => toDef(r, viewer));
    });
  }

  /** Deleting keeps stored values out of sight; the key cannot be reused. */
  async archive(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.customField.findFirst({ where: { id, tenantId: auth.tenantId, archivedAt: null }, select: { key: true, entity: true } });
      if (!row) throw notFound('Custom field');
      const users = (await this.definitions(tx, auth.tenantId, row.entity as Entity)).filter((d) => d.showWhen?.key === row.key || (d.type === 'FORMULA' && formulaRefs(d.formula).includes(row.key)));
      if (users.length) throw new ConflictException({ code: 'FIELD_IN_USE', message: `Other fields use this field: ${users.map((d) => d.label).join(', ')}. Change them first.` });
      await tx.customField.update({ where: { id }, data: { archivedAt: new Date(), active: false } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'custom_field.archived', entityType: 'custom_field', entityId: id, meta });
    });
  }

  private async checkPlan(tx: TenantTx, tenantId: string, d: Parameters<typeof isAdvancedField>[0]): Promise<void> {
    if (isAdvancedField(d) && !(await hasFeature(tx, tenantId, 'custom_fields_advanced'))) throw featureNotIncluded('custom_fields_advanced');
  }

  private async checkDesignations(tx: TenantTx, tenantId: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const found = await tx.designation.count({ where: { tenantId, id: { in: unique } } });
    if (found !== unique.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'viewDesignationIds', message: 'refers to a designation that does not exist' }] });
  }

  private checkDefault(type: CustomFieldType, options: string[], currency: string | null, raw: unknown): unknown {
    if (raw === undefined || raw === null || raw === '') return null;
    if (type === 'FILE') throw invalid('defaultValue', 'A file field cannot have a default');
    const v = coerce({ type, options, currency }, raw);
    if (v === undefined) throw invalid('defaultValue', `must be a valid ${type.toLowerCase()}`);
    return v;
  }

  /** A condition must test another field of the record type, with a test that fits it, and must not loop. */
  private checkCondition(siblings: CustomFieldDef[], key: string, raw: unknown): Record<string, unknown> | null {
    if (raw === null || raw === undefined) return null;
    const parsed = customFieldFilterSchema.safeParse(raw);
    if (!parsed.success) throw invalid('showWhen', 'must be a field, a test and a value');
    const c = parsed.data;
    const ctrl = siblings.find((d) => d.key === c.key);
    if (!ctrl || c.key === key || ctrl.type === 'FILE') throw invalid('showWhen.key', 'Pick another field of this record type');
    if (!filterOpsFor(ctrl.type).includes(c.op)) throw invalid('showWhen.op', 'This test does not fit that field');
    if (c.op !== 'set' && c.op !== 'unset' && (c.value === undefined || c.value === '' || (Array.isArray(c.value) && !c.value.length))) throw invalid('showWhen.value', 'Enter the value to test for');
    if (c.op === 'in' && !(Array.isArray(c.value) && c.value.every((v) => ctrl.options.includes(v)))) throw invalid('showWhen.value', 'Pick values from the list');
    if (conditionLoop(siblings, key, c)) throw invalid('showWhen.key', 'These conditions would depend on each other in a loop');
    return { key: c.key, op: c.op, ...(c.value !== undefined && c.op !== 'set' && c.op !== 'unset' ? { value: c.value } : {}) };
  }

  /** A formula may use number, currency and other formula fields of the same record type, and never itself. */
  private checkFormula(siblings: CustomFieldDef[], key: string, text: string): string {
    const p = parseFormula(text);
    if (!p.ok) throw invalid('formula', p.error);
    const byKey = new Map(siblings.map((d) => [d.key, d]));
    for (const ref of p.refs) {
      const d = byKey.get(ref);
      if (!d || ref === key) throw invalid('formula', `{${ref}} is not a field of this record type`);
      if (!FORMULA_INPUT_TYPES.includes(d.type)) throw invalid('formula', `${d.label} is not a number, currency or formula field`);
    }
    if (formulaLoop(siblings, key, text)) throw invalid('formula', 'This formula would use itself');
    return text.trim();
  }

  /**
   * Recalculates stored formula values after a definition changes, so filters, reports and exports see them (only
   * when the record type has formula fields). Values of fields hidden by a condition stay; reads hide them.
   */
  async refresh(tx: TenantTx, tenantId: string, entity: Entity): Promise<void> {
    const defs = await this.definitions(tx, tenantId, entity);
    if (!defs.some((d) => d.type === 'FORMULA')) return;
    const delegate = recordDelegate(tx, entity);
    let cursor: string | undefined;
    for (;;) {
      const rows = await delegate.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, customFields: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const r of rows) {
        const before = (r.customFields ?? {}) as Record<string, unknown>;
        // Only formulas change here: values of hidden fields are kept, so changing a condition loses nothing.
        const after = applyLogic(defs, before, true);
        if (!sameValue(before, after)) await delegate.update({ where: { id: r.id }, data: { customFields: after as Prisma.InputJsonValue } });
      }
      if (rows.length < 500) return;
      cursor = rows[rows.length - 1]!.id;
    }
  }

  // ───────────── Values ─────────────

  /**
   * Validates and coerces values for a person (ADR 0062): fields they may not see or change are refused unless the
   * value is unchanged, hidden values are kept, defaults fill new records, and required fields are enforced only for
   * fields the person can fill in. With `existing`, values merge (PATCH) and `null` clears a key.
   */
  async validateFor(
    tx: TenantTx,
    auth: AuthContext,
    entity: Entity,
    values: Record<string, unknown> | undefined,
    existing?: Record<string, unknown>,
    preloaded?: { defs: CustomFieldDef[]; viewer: FieldViewer },
  ): Promise<Record<string, unknown> | undefined> {
    const creating = existing === undefined;
    if (values === undefined && !creating) return undefined;
    const { defs } = preloaded ?? (await this.accessFor(tx, auth, entity));
    return this.check(tx, auth.tenantId, auth.userId, entity, defs, values, existing, creating);
  }

  /** The same without a person (imports by the system, older callers): every active field is visible and editable. */
  async validate(
    tx: TenantTx,
    tenantId: string,
    entity: Entity,
    values: Record<string, unknown> | undefined,
    existing?: Record<string, unknown>,
    preloaded?: CustomFieldDef[],
  ): Promise<Record<string, unknown> | undefined> {
    if (values === undefined && existing !== undefined) return undefined;
    const defs = preloaded ?? (await this.definitions(tx, tenantId, entity));
    return this.check(tx, tenantId, null, entity, defs, values, existing, existing === undefined);
  }

  private async check(
    tx: TenantTx,
    tenantId: string,
    userId: string | null,
    entity: Entity,
    defs: CustomFieldDef[],
    values: Record<string, unknown> | undefined,
    existing: Record<string, unknown> | undefined,
    creating: boolean,
  ): Promise<Record<string, unknown>> {
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const out: Record<string, unknown> = { ...(existing ?? {}) };
    const details: { path: string; message: string }[] = [];
    const denied: string[] = [];

    for (const [key, raw] of Object.entries(values ?? {})) {
      // Reserved keys used by built-in features (e.g. qualification answers) pass through as objects.
      if (key === 'qualification') {
        if (raw !== null && typeof raw !== 'object') details.push({ path: `customFields.${key}`, message: 'must be an object' });
        else out[key] = raw;
        continue;
      }
      const def = byKey.get(key);
      if (!def) {
        details.push({ path: `customFields.${key}`, message: 'is not a defined custom field' });
        continue;
      }
      // Formula values are calculated below; forms send back what they show.
      if (def.type === 'FORMULA') continue;
      const cleared = raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
      const coerced = cleared ? undefined : def.type === 'FILE' ? await this.fileValue(tx, tenantId, userId, entity, def.key, raw, out[key]) : coerce(def, raw);
      if (!cleared && coerced === undefined) {
        details.push({ path: `customFields.${key}`, message: `must be a valid ${def.type.toLowerCase()}` });
        continue;
      }
      if (!def.access.edit) {
        // Forms send back what they show; an unchanged value is not a change.
        if (!sameValue(coerced, out[key])) denied.push(def.label);
        continue;
      }
      if (cleared) delete out[key];
      else out[key] = coerced;
    }
    if (denied.length) {
      throw new ForbiddenException({ code: 'FIELD_READ_ONLY', message: 'You cannot change some of these fields.', details: denied.map((label) => ({ path: 'customFields', message: label })) });
    }
    for (const def of defs) {
      if (creating && out[def.key] === undefined && def.defaultValue !== null && def.defaultValue !== undefined) out[def.key] = def.defaultValue;
    }
    // Conditions and formulas (ADR 0062): a field whose condition fails keeps no value and is not required.
    const { shown } = resolveFields(defs, (k) => out[k]);
    const logic = applyLogic(defs, out);
    for (const k of Object.keys(out)) if (!(k in logic)) delete out[k];
    Object.assign(out, logic);
    for (const def of defs) {
      if (!shown.has(def.key) || def.type === 'FORMULA') continue;
      if (def.required && def.access.edit && (out[def.key] === undefined || out[def.key] === null)) {
        details.push({ path: `customFields.${def.key}`, message: `${def.label} is required` });
      }
    }
    if (details.length) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details });
    }
    return out;
  }

  /** Removes values the person may not see, and values of deleted or switched-off fields. */
  visibleValues(defs: CustomFieldDef[], values: unknown): Record<string, unknown> {
    const src = (values ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if ('qualification' in src) out.qualification = src.qualification;
    const { shown } = resolveFields(defs, (k) => src[k]);
    for (const d of defs) if (d.access.view && shown.has(d.key) && src[d.key] !== undefined) out[d.key] = src[d.key];
    return out;
  }

  /** A reader for list and detail rows: one query per request, then a pure filter per record. */
  async reader(tx: TenantTx, auth: AuthContext, entity: Entity): Promise<(values: unknown) => Record<string, unknown>> {
    const { defs } = await this.accessFor(tx, auth, entity);
    return (values) => this.visibleValues(defs, values);
  }

  // ───────────── Files ─────────────

  upload(auth: AuthContext, entity: Entity, key: string, file: { name: string; contentType: string; data: Buffer }): Promise<CustomFieldFile> {
    checkFile(file);
    return this.prisma.run(auth, async (tx) => {
      const { defs } = await this.accessFor(tx, auth, entity);
      const def = defs.find((d) => d.key === key && d.type === 'FILE');
      if (!def) throw notFound('Custom field');
      if (!def.access.edit) throw new ForbiddenException({ code: 'FIELD_READ_ONLY', message: 'You cannot change some of these fields.', details: [{ path: 'customFields', message: def.label }] });
      const doc = await tx.customFieldFile.create({
        data: {
          tenantId: auth.tenantId, entity, fieldKey: key, name: file.name, contentType: file.contentType, sizeBytes: file.data.length,
          data: new Uint8Array(file.data), sha256: createHash('sha256').update(file.data).digest('hex'), uploadedById: auth.userId,
        },
        select: { id: true, name: true, sizeBytes: true, contentType: true },
      });
      return { id: doc.id, name: doc.name, size: doc.sizeBytes, contentType: doc.contentType };
    });
  }

  /** Downloads follow the record: the person must see its details and the field. */
  download(auth: AuthContext, id: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    return this.prisma.run(auth, async (tx) => {
      const f = await tx.customFieldFile.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!f) throw notFound('File');
      const { defs } = await this.accessFor(tx, auth, f.entity as Entity);
      const def = defs.find((d) => d.key === f.fieldKey);
      const allowed = f.recordId === null ? f.uploadedById === auth.userId : !!def?.access.view && (await this.recordDetailsVisible(tx, auth, f.entity as Entity, f.recordId));
      if (!allowed) throw notFound('File');
      return { name: f.name, contentType: f.contentType, data: Buffer.from(f.data) };
    });
  }

  /**
   * After a record is saved: files now in its values belong to it, and files it no longer holds are deleted.
   * Uploads nobody saved into a record are removed after a day.
   */
  async claimFiles(tx: TenantTx, tenantId: string, entity: Entity, recordId: string, values: Record<string, unknown> | undefined): Promise<void> {
    if (!values) return;
    const ids = Object.values(values).flatMap((v) => (Array.isArray(v) ? v.filter((x): x is CustomFieldFile => !!x && typeof x === 'object' && 'id' in x).map((x) => x.id) : []));
    if (ids.length) await tx.customFieldFile.updateMany({ where: { tenantId, entity, id: { in: ids }, recordId: null }, data: { recordId } });
    await tx.customFieldFile.deleteMany({ where: { tenantId, entity, recordId, ...(ids.length ? { id: { notIn: ids } } : {}) } });
    await tx.customFieldFile.deleteMany({ where: { tenantId, recordId: null, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  }

  private async fileValue(tx: TenantTx, tenantId: string, userId: string | null, entity: Entity, key: string, raw: unknown, current: unknown): Promise<CustomFieldFile[] | undefined> {
    const list = Array.isArray(raw) ? raw : [raw];
    const ids = list.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : null));
    if (ids.some((i) => i === null) || ids.length > CUSTOM_FIELD_LIMITS.files) return undefined;
    const kept = new Set(Array.isArray(current) ? (current as CustomFieldFile[]).map((f) => f.id) : []);
    const rows = await tx.customFieldFile.findMany({ where: { tenantId, entity, fieldKey: key, id: { in: ids as string[] } }, select: { id: true, name: true, sizeBytes: true, contentType: true, recordId: true, uploadedById: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: CustomFieldFile[] = [];
    for (const id of ids as string[]) {
      const r = byId.get(id);
      // A new upload must be the person's own; a file already in the value can stay.
      if (!r || (!kept.has(id) && (r.recordId !== null || (userId !== null && r.uploadedById !== userId)))) return undefined;
      out.push({ id: r.id, name: r.name, size: r.sizeBytes, contentType: r.contentType });
    }
    return out;
  }

  private async recordDetailsVisible(tx: TenantTx, auth: AuthContext, entity: Entity, recordId: string): Promise<boolean> {
    const v = await visibility(tx, auth);
    const has = (p: string) => auth.permissions.includes(p);
    const company = async (id: string | null) => {
      if (!id) return true;
      const c = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { ownerId: true } });
      return !!c && canSeeDetails(v, c.ownerId);
    };
    switch (entity) {
      case 'COMPANY':
        return has('companies:read') && (await company(recordId));
      case 'CONTACT': {
        const c = await tx.contact.findFirst({ where: { id: recordId, tenantId: auth.tenantId, deletedAt: null, ...contactScope(v) }, select: { ownerId: true } });
        return has('contacts:read') && !!c && canSeeDetails(v, c.ownerId);
      }
      case 'LEAD': {
        const l = await tx.lead.findFirst({ where: { id: recordId, tenantId: auth.tenantId, deletedAt: null, ...leadScope(v) }, select: { ownerId: true } });
        return has('leads:read') && !!l && canSeeDetails(v, l.ownerId);
      }
      case 'OPPORTUNITY':
        return has('deals:read') && !!(await tx.opportunity.findFirst({ where: { id: recordId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true } }));
      case 'FOLLOW_UP': {
        const t = await tx.task.findFirst({ where: { id: recordId, tenantId: auth.tenantId, deletedAt: null }, select: { companyId: true } });
        return has('activities:read') && !!t && (await company(t.companyId));
      }
      case 'RFQ': {
        const r = await tx.rfq.findFirst({ where: { id: recordId, tenantId: auth.tenantId, deletedAt: null }, select: { companyId: true } });
        return has('companies:read') && !!r && (await company(r.companyId));
      }
    }
  }

  // ───────────── Search and filters ─────────────

  /**
   * Turns custom field filters into a raw MongoDB filter on `custom_fields`. Fields the person cannot see, unknown
   * keys and operators that do not fit the type are refused, so a filter never reveals a hidden value.
   */
  async rawFilter(tx: TenantTx, auth: AuthContext, entity: Entity, filters: CustomFieldFilter[] | undefined): Promise<Record<string, unknown> | null> {
    if (!filters?.length) return null;
    const { defs } = await this.accessFor(tx, auth, entity);
    const byKey = new Map(defs.filter((d) => d.access.view).map((d) => [d.key, d]));
    const and: Record<string, unknown>[] = [];
    const details: { path: string; message: string }[] = [];
    for (const [i, f] of filters.entries()) {
      const def = byKey.get(f.key);
      if (!def) {
        details.push({ path: `cf.${i}.key`, message: 'is not a custom field you can filter by' });
        continue;
      }
      if (!filterOpsFor(def.type).includes(f.op)) {
        details.push({ path: `cf.${i}.op`, message: 'does not fit this field type' });
        continue;
      }
      const clause = filterClause(def, f);
      if (!clause) details.push({ path: `cf.${i}.value`, message: `must be a valid ${def.type.toLowerCase()}` });
      else and.push(clause);
    }
    if (details.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details });
    return { $and: and };
  }

  /**
   * Ids of records of a collection matching the filter (with the workspace guard's own match added first). Capped,
   * so a broad filter on a huge workspace stays bounded; the list says how many matched.
   */
  async matchingIds(delegate: { findRaw(args: { filter: object; options?: object }): unknown }, filter: Record<string, unknown>, cap = 10_000): Promise<string[]> {
    const rows = (await delegate.findRaw({ filter: { ...filter, deleted_at: null }, options: { projection: { _id: 1 }, limit: cap } })) as unknown as { _id: string }[];
    return rows.map((r) => r._id);
  }

  /** Searchable text fields the person may see, as raw paths for a case-insensitive search. */
  async searchPaths(tx: TenantTx, auth: AuthContext, entity: Entity): Promise<{ key: string; label: string; path: string }[]> {
    const { defs } = await this.accessFor(tx, auth, entity);
    return defs.filter((d) => d.searchable && d.access.view && SEARCHABLE_FIELD_TYPES.includes(d.type)).map((d) => ({ key: d.key, label: d.label, path: cfPath(d.key) }));
  }
}

function toDef(r: Row, viewer: FieldViewer): CustomFieldDef {
  const view = viewer.admin || r.viewDesignationIds.length === 0 || (!!viewer.designationId && r.viewDesignationIds.includes(viewer.designationId));
  const edit = view && (viewer.admin || r.editDesignationIds.length === 0 || (!!viewer.designationId && r.editDesignationIds.includes(viewer.designationId)));
  return {
    id: r.id, entity: r.entity as Entity, key: r.key, label: r.label, description: r.description ?? null, type: r.type as CustomFieldType, options: r.options,
    required: r.required, defaultValue: r.defaultValue ?? null, currency: r.currency ?? null, viewDesignationIds: r.viewDesignationIds, editDesignationIds: r.editDesignationIds,
    showInForms: r.showInForms ?? true, searchable: r.searchable ?? false, active: r.active ?? true, position: r.position,
    showWhen: (r.showWhen as CustomFieldFilter | null) ?? null, formula: r.formula ?? null, decimals: r.decimals ?? null,
    // Nobody types into a formula field.
    access: { view, edit: edit && r.type !== 'FORMULA' },
  };
}

function invalid(path: string, message: string) {
  return new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path, message }] });
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9()\s.-]{5,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerces one value to the field's type; undefined when it does not fit. Exported for tests. */
export function coerce(def: { type: CustomFieldType; options: string[]; currency?: string | null }, raw: unknown): unknown {
  switch (def.type) {
    case 'TEXT':
      return typeof raw === 'string' && raw.length <= CUSTOM_FIELD_LIMITS.text ? raw : typeof raw === 'number' ? String(raw) : undefined;
    case 'TEXTAREA':
      return typeof raw === 'string' && raw.length <= CUSTOM_FIELD_LIMITS.textarea ? raw : undefined;
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : undefined;
    }
    case 'CURRENCY': {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as { amount?: unknown; currency?: unknown };
        const amount = typeof o.amount === 'number' ? o.amount : typeof o.amount === 'string' && o.amount.trim() !== '' ? Number(o.amount) : NaN;
        const currency = typeof o.currency === 'string' ? o.currency.trim().toUpperCase() : (def.currency ?? null);
        return Number.isFinite(amount) && currency && /^[A-Z]{3}$/.test(currency) ? { amount: Math.round(amount * 100) / 100, currency } : undefined;
      }
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      return Number.isFinite(n) && def.currency ? { amount: Math.round(n * 100) / 100, currency: def.currency } : undefined;
    }
    case 'BOOLEAN':
    case 'CHECKBOX':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'yes' || raw === '1') return true;
      if (raw === 'false' || raw === 'no' || raw === '0') return false;
      return undefined;
    case 'DATE':
      return typeof raw === 'string' && DATE.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
    case 'DATETIME': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return undefined;
      const t = Date.parse(raw);
      return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    case 'SELECT':
      return typeof raw === 'string' && def.options.includes(raw) ? raw : undefined;
    case 'MULTISELECT': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s*[,;|]\s*/).filter(Boolean) : null;
      if (!list || list.some((x) => typeof x !== 'string' || !def.options.includes(x))) return undefined;
      return def.options.filter((o) => list.includes(o));
    }
    case 'URL': {
      if (typeof raw !== 'string' || raw.length > CUSTOM_FIELD_LIMITS.text) return undefined;
      const v = /^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
      try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
      } catch {
        return undefined;
      }
    }
    case 'EMAIL':
      return typeof raw === 'string' && raw.length <= 320 && EMAIL.test(raw.trim()) ? raw.trim().toLowerCase() : undefined;
    case 'PHONE':
      return typeof raw === 'string' && PHONE.test(raw.trim()) ? raw.trim() : typeof raw === 'number' ? String(raw) : undefined;
    case 'FILE':
      return undefined; // checked against uploads in fileValue
    case 'FORMULA':
      return undefined; // calculated, never entered
  }
}

const formulaRefs = (f: string | null) => {
  const p = f ? parseFormula(f) : null;
  return p?.ok ? p.refs : [];
};

/** Values with formulas calculated and values of fields whose condition fails left out. Exported for tests. */
export function applyLogic(defs: ReadonlyArray<Pick<CustomFieldDef, 'key' | 'type' | 'showWhen' | 'formula' | 'decimals'>>, values: Record<string, unknown>, keepHidden = false): Record<string, unknown> {
  if (!defs.some((d) => d.showWhen || d.type === 'FORMULA')) return values;
  const { shown, computed } = resolveFields(defs, (k) => values[k]);
  const out = { ...values };
  for (const d of defs) {
    if (d.type === 'FORMULA') {
      const v = computed.get(d.key);
      if (v === null || v === undefined) delete out[d.key];
      else out[d.key] = v;
    } else if (!keepHidden && !shown.has(d.key)) delete out[d.key];
  }
  return out;
}

type RecordDelegate = {
  findMany(args: object): Promise<{ id: string; customFields: unknown }[]>;
  update(args: object): Promise<unknown>;
};

function recordDelegate(tx: TenantTx, entity: Entity): RecordDelegate {
  const d = { COMPANY: tx.company, CONTACT: tx.contact, LEAD: tx.lead, OPPORTUNITY: tx.opportunity, FOLLOW_UP: tx.task, RFQ: tx.rfq }[entity];
  return d as unknown as RecordDelegate;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One raw MongoDB clause for a filter, or null when the value does not fit. Exported for tests. */
export function filterClause(def: Pick<CustomFieldDef, 'key' | 'type' | 'options' | 'currency'>, f: CustomFieldFilter): Record<string, unknown> | null {
  const path = cfPath(def.key);
  const unsetClause = { $or: [{ [path]: { $exists: false } }, { [path]: null }, { [path]: '' }, { [path]: [] }] };
  if (f.op === 'set') return { $nor: unsetClause.$or };
  if (f.op === 'unset') return unsetClause;
  const target = def.type === 'CURRENCY' ? `${path}.amount` : path;
  if (f.op === 'contains') return typeof f.value === 'string' && f.value.trim() ? { [path]: { $regex: escapeRegex(f.value.trim()), $options: 'i' } } : null;
  if (f.op === 'in') {
    const list = Array.isArray(f.value) ? f.value : typeof f.value === 'string' ? [f.value] : null;
    return list && list.length ? { [path]: { $in: list } } : null;
  }
  let v: unknown;
  if (def.type === 'CURRENCY' || def.type === 'NUMBER' || def.type === 'FORMULA') v = typeof f.value === 'number' ? f.value : typeof f.value === 'string' && f.value.trim() !== '' ? Number(f.value) : NaN;
  else if (def.type === 'BOOLEAN' || def.type === 'CHECKBOX') v = coerce({ type: def.type, options: [] }, f.value);
  else if (def.type === 'DATE') v = typeof f.value === 'string' && DATE.test(f.value) ? f.value : undefined;
  else if (def.type === 'DATETIME') v = typeof f.value === 'string' && !Number.isNaN(Date.parse(f.value)) ? new Date(f.value).toISOString() : undefined;
  else v = typeof f.value === 'string' ? f.value : undefined;
  if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return null;
  if (f.op === 'eq') {
    if (def.type === 'MULTISELECT' || def.type === 'SELECT' || def.type === 'NUMBER' || def.type === 'FORMULA' || def.type === 'CURRENCY' || def.type === 'BOOLEAN' || def.type === 'CHECKBOX' || def.type === 'DATE' || def.type === 'DATETIME') return { [target]: v };
    return { [path]: { $regex: `^${escapeRegex(String(v))}$`, $options: 'i' } };
  }
  if (f.op === 'neq') return { [target]: { $ne: v } };
  if (f.op === 'gte') return { [target]: { $gte: v } };
  if (f.op === 'lte') return { [target]: { $lte: v } };
  return null;
}
