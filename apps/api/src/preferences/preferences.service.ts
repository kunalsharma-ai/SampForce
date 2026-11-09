import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Appearance,
  MAX_SAVED_THEMES,
  normalizeAppearance,
  type PreferencesResponse,
  normalizeRegional,
  type Regional,
  type RegionalResponse,
  type SavedTheme,
  type SavedThemeInput,
} from '@dealflow/types';
import { Prisma } from '@dealflow/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';

/**
 * Interface settings from the Theme Studio. A person's own settings live on their account (not per workspace, so they
 * follow them everywhere); a workspace admin can set a default for members who have not chosen their own.
 */
@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(auth: AuthContext): Promise<PreferencesResponse> {
    const [own, tenant] = await Promise.all([
      this.prisma.userPreference.findUnique({ where: { userId: auth.userId } }),
      this.prisma.run(auth, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultAppearance: true } })),
    ]);
    const workspaceDefault = tenant.defaultAppearance ? normalizeAppearance(tenant.defaultAppearance) : null;
    if (own) return { appearance: normalizeAppearance(own.appearance), source: 'user', workspaceDefault, updatedAt: own.updatedAt.toISOString() };
    return {
      appearance: workspaceDefault ?? normalizeAppearance(null),
      source: workspaceDefault ? 'workspace' : 'default',
      workspaceDefault,
      updatedAt: null,
    };
  }

  async save(auth: AuthContext, appearance: Appearance): Promise<PreferencesResponse> {
    const value = appearance as unknown as Prisma.InputJsonValue;
    await this.prisma.userPreference.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, appearance: value },
      update: { appearance: value },
    });
    return this.get(auth);
  }

  /** Forgets the person's own settings, so the workspace default (or SampForce's) applies again. */
  async reset(auth: AuthContext): Promise<PreferencesResponse> {
    await this.prisma.userPreference.deleteMany({ where: { userId: auth.userId } });
    return this.get(auth);
  }

  async setWorkspaceDefault(auth: AuthContext, appearance: Appearance | null, meta: RequestMeta): Promise<PreferencesResponse> {
    await this.prisma.run(auth, async (tx) => {
      await tx.tenant.update({
        where: { id: auth.tenantId },
        data: { defaultAppearance: appearance ? (appearance as unknown as Prisma.InputJsonValue) : null },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: appearance ? 'tenant.appearance_default_set' : 'tenant.appearance_default_cleared',
        entityType: 'tenant',
        entityId: auth.tenantId,
        metadata: appearance ? { themeId: appearance.themeId, mode: appearance.mode } : {},
        meta,
      });
    });
    return this.get(auth);
  }

  /** The person's language and regional formats; SampForce's defaults until they choose. */
  async getRegional(auth: AuthContext): Promise<RegionalResponse> {
    const row = await this.prisma.userRegionalSetting.findUnique({ where: { userId: auth.userId } });
    if (!row) return { regional: normalizeRegional(null), source: 'default', updatedAt: null };
    return { regional: normalizeRegional({ language: row.language, formatLocale: row.formatLocale }), source: 'user', updatedAt: row.updatedAt.toISOString() };
  }

  async saveRegional(auth: AuthContext, regional: Regional): Promise<RegionalResponse> {
    const data = { language: regional.language, formatLocale: regional.formatLocale };
    await this.prisma.userRegionalSetting.upsert({ where: { userId: auth.userId }, create: { userId: auth.userId, ...data }, update: data });
    return this.getRegional(auth);
  }

  async resetRegional(auth: AuthContext): Promise<RegionalResponse> {
    await this.prisma.userRegionalSetting.deleteMany({ where: { userId: auth.userId } });
    return this.getRegional(auth);
  }

  async listThemes(auth: AuthContext): Promise<SavedTheme[]> {
    const rows = await this.prisma.userSavedTheme.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toSaved);
  }

  async saveTheme(auth: AuthContext, input: SavedThemeInput): Promise<SavedTheme> {
    const settings = input.settings as unknown as Prisma.InputJsonValue;
    const existing = await this.prisma.userSavedTheme.findUnique({ where: { userId_name: { userId: auth.userId, name: input.name } } });
    if (existing) {
      // Saving under an existing name updates that theme.
      return toSaved(await this.prisma.userSavedTheme.update({ where: { id: existing.id }, data: { settings } }));
    }
    const count = await this.prisma.userSavedTheme.count({ where: { userId: auth.userId } });
    if (count >= MAX_SAVED_THEMES) {
      throw new ConflictException({ code: 'LIMIT_REACHED', message: `You can keep up to ${MAX_SAVED_THEMES} saved themes. Delete one first.` });
    }
    return toSaved(await this.prisma.userSavedTheme.create({ data: { userId: auth.userId, name: input.name, settings } }));
  }

  async deleteTheme(auth: AuthContext, id: string): Promise<void> {
    const { count } = await this.prisma.userSavedTheme.deleteMany({ where: { id, userId: auth.userId } });
    if (count === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Saved theme not found.' });
  }
}

function toSaved(r: { id: string; name: string; settings: Prisma.JsonValue; createdAt: Date }): SavedTheme {
  return { id: r.id, name: r.name, settings: normalizeAppearance(r.settings), createdAt: r.createdAt.toISOString() };
}
