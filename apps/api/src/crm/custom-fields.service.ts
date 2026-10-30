import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { CustomFieldDef, CustomFieldDefInput } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from './crm-helpers';

type Entity = CustomFieldDef['entity'];

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, entity?: Entity): Promise<CustomFieldDef[]> {
    return this.prisma.run(auth, (tx) => this.definitions(tx, auth.tenantId, entity));
  }

  definitions(tx: TenantTx, tenantId: string, entity?: Entity): Promise<CustomFieldDef[]> {
    return tx.customField.findMany({
      where: { tenantId, archivedAt: null, ...(entity ? { entity } : {}) },
      orderBy: [{ entity: 'asc' }, { position: 'asc' }],
      select: { id: true, entity: true, key: true, label: true, type: true, options: true, required: true, position: true },
    });
  }

  async create(auth: AuthContext, input: CustomFieldDefInput, meta: RequestMeta): Promise<CustomFieldDef> {
    return this.prisma.run(auth, async (tx) => {
      const position = await tx.customField.count({ where: { tenantId: auth.tenantId, entity: input.entity } });
      try {
        const def = await tx.customField.create({ data: { ...input, tenantId: auth.tenantId, position } });
        await this.audit.record(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'custom_field.created',
          entityType: 'custom_field',
          entityId: def.id,
          metadata: { entity: def.entity, key: def.key, type: def.type },
          meta,
        });
        return def;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException({ code: 'DUPLICATE_KEY', message: 'A field with this key already exists.' });
        }
        throw err;
      }
    });
  }

  async archive(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const { count } = await tx.customField.updateMany({
        where: { id, tenantId: auth.tenantId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (count === 0) throw notFound('Custom field');
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'custom_field.archived',
        entityType: 'custom_field',
        entityId: id,
        meta,
      });
    });
  }

  /**
   * Validates and coerces custom field values against the tenant's definitions. Unknown keys are
   * rejected. With `existing`, values are merged (PATCH semantics) and `null` clears a key.
   */
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
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const out: Record<string, unknown> = { ...(existing ?? {}) };
    const details: { path: string; message: string }[] = [];

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
      if (raw === null || raw === '') {
        delete out[key];
        continue;
      }
      const coerced = coerce(def, raw);
      if (coerced === undefined) details.push({ path: `customFields.${key}`, message: `must be a valid ${def.type.toLowerCase()}` });
      else out[key] = coerced;
    }
    for (const def of defs) {
      if (def.required && (out[def.key] === undefined || out[def.key] === null)) {
        details.push({ path: `customFields.${def.key}`, message: `${def.label} is required` });
      }
    }
    if (details.length) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details });
    }
    return out;
  }
}

function coerce(def: CustomFieldDef, raw: unknown): unknown {
  switch (def.type) {
    case 'TEXT':
      return typeof raw === 'string' && raw.length <= 2000 ? raw : typeof raw === 'number' ? String(raw) : undefined;
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : undefined;
    }
    case 'BOOLEAN':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'yes' || raw === '1') return true;
      if (raw === 'false' || raw === 'no' || raw === '0') return false;
      return undefined;
    case 'DATE':
      return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
    case 'SELECT':
      return typeof raw === 'string' && def.options.includes(raw) ? raw : undefined;
  }
}
