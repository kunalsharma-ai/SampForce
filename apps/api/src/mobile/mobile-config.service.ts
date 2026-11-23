import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  defaultMobileConfig,
  MOBILE_MODULE_BY_KEY,
  MOBILE_RECORD_MODULES,
  type MobileAppConfig,
  type MobileAppConfigInput,
  mobileAppConfigSchema,
  type MobileConfigCenter,
  type MobileConfigResponse,
  type MobileConfigVersionRow,
  type MobileRecordModule,
  normalizeMobileConfig,
  resolveMobileConfig,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { entitlementsFor } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { resolveWorkspaceAccess } from '../workspaces/access';

/** Reads a stored configuration, filling in anything added since it was saved. */
function readConfig(json: Prisma.JsonValue | null | undefined): MobileAppConfig {
  const parsed = mobileAppConfigSchema.safeParse(json);
  return parsed.success ? normalizeMobileConfig(parsed.data) : defaultMobileConfig();
}


export async function publishedConfigVersion(tx: TenantTx, tenantId: string): Promise<number> {
  const row = await tx.mobileConfig.findUnique({ where: { tenantId }, select: { publishedVersion: true } });
  return row?.publishedVersion ?? 0;
}

/**
 * The Mobile Configuration Center (ADR 0072, M2). The Super Workspace edits a draft, publishes it as a numbered
 * version and can put an older version back. Phones get the published version narrowed to the person: their level,
 * their plan and their role. The same narrowing decides what the API accepts from a phone (see field-policy.ts).
 */
@Injectable()
export class MobileConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async center(auth: AuthContext): Promise<MobileConfigCenter> {
    return this.prisma.run(auth, (tx) => this.build(tx, auth.tenantId));
  }

  async saveDraft(auth: AuthContext, input: MobileAppConfigInput, meta: RequestMeta): Promise<MobileConfigCenter> {
    return this.prisma.run(auth, async (tx) => {
      await this.checkCustomFields(tx, auth.tenantId, input);
      const draft = normalizeMobileConfig(input) as unknown as Prisma.InputJsonValue;
      const now = new Date();
      await tx.mobileConfig.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, draft, draftUpdatedAt: now, draftUpdatedById: auth.userId },
        update: { draft, draftUpdatedAt: now, draftUpdatedById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'mobile.config_saved', entityType: 'mobile_config', entityId: auth.tenantId, meta });
      return this.build(tx, auth.tenantId);
    });
  }

  /** Throws the draft away: it goes back to the published version (or the default, before the first publish). */
  async discardDraft(auth: AuthContext, meta: RequestMeta): Promise<MobileConfigCenter> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.mobileConfig.findUnique({ where: { tenantId: auth.tenantId } });
      if (row) {
        const published = row.publishedVersion ? await tx.mobileConfigVersion.findUnique({ where: { tenantId_version: { tenantId: auth.tenantId, version: row.publishedVersion } } }) : null;
        const draft = (published ? readConfig(published.config) : defaultMobileConfig()) as unknown as Prisma.InputJsonValue;
        await tx.mobileConfig.update({ where: { tenantId: auth.tenantId }, data: { draft, draftUpdatedAt: new Date(), draftUpdatedById: auth.userId } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'mobile.config_discarded', entityType: 'mobile_config', entityId: auth.tenantId, meta });
      }
      return this.build(tx, auth.tenantId);
    });
  }

  async publish(auth: AuthContext, note: string | undefined, meta: RequestMeta): Promise<MobileConfigCenter> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.mobileConfig.findUnique({ where: { tenantId: auth.tenantId } });
      const config = row ? readConfig(row.draft) : defaultMobileConfig();
      const version = await this.writeVersion(tx, auth, config, note ?? null, null);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'mobile.config_published', entityType: 'mobile_config', entityId: auth.tenantId, metadata: { version, note: note ?? null }, meta });
      return this.build(tx, auth.tenantId);
    });
  }

  /** Publishes an older version again, as a new version, and makes it the draft. History is never rewritten. */
  async rollback(auth: AuthContext, version: number, meta: RequestMeta): Promise<MobileConfigCenter> {
    return this.prisma.run(auth, async (tx) => {
      const old = await tx.mobileConfigVersion.findUnique({ where: { tenantId_version: { tenantId: auth.tenantId, version } } });
      if (!old) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That version does not exist.' });
      const config = readConfig(old.config);
      const next = await this.writeVersion(tx, auth, config, null, version);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'mobile.config_rolled_back', entityType: 'mobile_config', entityId: auth.tenantId, metadata: { version: next, restoredFrom: version }, meta });
      return this.build(tx, auth.tenantId);
    });
  }

  /** The configuration for the signed-in phone user. `known` is the version the phone already has. */
  async forPhone(auth: AuthContext, known: number | null): Promise<MobileConfigResponse> {
    return this.prisma.run(auth, async (tx) => {
      const version = await publishedConfigVersion(tx, auth.tenantId);
      if (known !== null && known === version) return { version, unchanged: true, config: null };
      return { version, unchanged: false, config: await this.resolvedFor(tx, auth, version) };
    });
  }

  /** What one person may use, by the published version. Shared with the field rules for phone requests. */
  async resolvedFor(tx: TenantTx, auth: AuthContext, version?: number) {
    const v = version ?? (await publishedConfigVersion(tx, auth.tenantId));
    const row = v ? await tx.mobileConfigVersion.findUnique({ where: { tenantId_version: { tenantId: auth.tenantId, version: v } }, select: { config: true } }) : null;
    const config = row ? readConfig(row.config) : defaultMobileConfig();
    // The person's workspace (ADR 0071) decides the level, and narrows the plan's features and the actions allowed.
    const access = await resolveWorkspaceAccess(tx, auth.tenantId, auth.workspaceNodeId);
    return resolveMobileConfig(config, { level: access.level, features: access.features, actions: access.actions, permissions: auth.permissions });
  }

  private async writeVersion(tx: TenantTx, auth: AuthContext, config: MobileAppConfig, note: string | null, restoredFrom: number | null): Promise<number> {
    const last = await tx.mobileConfigVersion.findFirst({ where: { tenantId: auth.tenantId }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    const json = config as unknown as Prisma.InputJsonValue;
    // The unique (tenant, version) index refuses a second publish racing for the same number.
    await tx.mobileConfigVersion.create({ data: { tenantId: auth.tenantId, version, config: json, note, restoredFrom, publishedById: auth.userId } });
    await tx.mobileConfig.upsert({
      where: { tenantId: auth.tenantId },
      create: { tenantId: auth.tenantId, draft: json, draftUpdatedAt: new Date(), draftUpdatedById: auth.userId, publishedVersion: version },
      update: { publishedVersion: version, ...(restoredFrom ? { draft: json, draftUpdatedAt: new Date(), draftUpdatedById: auth.userId } : {}) },
    });
    return version;
  }

  /** Custom fields named in the draft must exist, be active and belong to the module's record type. */
  private async checkCustomFields(tx: TenantTx, tenantId: string, input: MobileAppConfigInput): Promise<void> {
    const available = await this.customFields(tx, tenantId);
    for (const module of MOBILE_RECORD_MODULES) {
      const keys = new Set((available[module] ?? []).map((f) => `cf.${f.key}`));
      for (const key of Object.keys(input.fields[module] ?? {})) {
        if (key.startsWith('cf.') && !keys.has(key)) {
          throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Use a field from the list.', details: [{ path: `fields.${module}.${key}`, message: 'Use a field from the list.' }] });
        }
      }
    }
  }

  private async customFields(tx: TenantTx, tenantId: string): Promise<MobileConfigCenter['customFields']> {
    const entities = MOBILE_RECORD_MODULES.map((m) => [m, MOBILE_MODULE_BY_KEY[m].customFieldEntity] as const).filter((x): x is readonly [MobileRecordModule, NonNullable<(typeof x)[1]>] => !!x[1]);
    const rows = await tx.customField.findMany({
      where: { tenantId, active: true, archivedAt: null, entity: { in: entities.map(([, e]) => e) } },
      select: { entity: true, key: true, label: true },
      orderBy: { position: 'asc' },
    });
    const out: MobileConfigCenter['customFields'] = {};
    for (const [module, entity] of entities) out[module] = rows.filter((r) => r.entity === entity).map((r) => ({ key: r.key, label: r.label }));
    return out;
  }

  private async build(tx: TenantTx, tenantId: string): Promise<MobileConfigCenter> {
    const [row, versions, ent, customFields] = await Promise.all([
      tx.mobileConfig.findUnique({ where: { tenantId } }),
      tx.mobileConfigVersion.findMany({ where: { tenantId }, orderBy: { version: 'desc' }, take: 50, select: { version: true, publishedAt: true, publishedById: true, note: true, restoredFrom: true, config: true } }),
      entitlementsFor(tx, tenantId),
      this.customFields(tx, tenantId),
    ]);
    const userIds = [...new Set([row?.draftUpdatedById, ...versions.map((v) => v.publishedById)].filter((x): x is string => !!x))];
    const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const name = (id: string | null | undefined) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);
    const rows: MobileConfigVersionRow[] = versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt.toISOString(), publishedBy: name(v.publishedById), note: v.note, restoredFrom: v.restoredFrom }));
    const draft = row ? readConfig(row.draft) : defaultMobileConfig();
    const current = versions.find((v) => v.version === row?.publishedVersion);
    const publishedConfig = current ? readConfig(current.config) : null;
    return {
      draft,
      draftUpdatedAt: row?.draftUpdatedAt?.toISOString() ?? null,
      draftUpdatedBy: name(row?.draftUpdatedById),
      unpublishedChanges: !publishedConfig || JSON.stringify(publishedConfig) !== JSON.stringify(draft),
      published: rows.find((r) => r.version === row?.publishedVersion) ?? null,
      versions: rows,
      customFields,
      features: ent.features,
    };
  }
}
