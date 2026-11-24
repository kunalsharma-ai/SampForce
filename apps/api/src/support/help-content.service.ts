import { createHash } from 'node:crypto';
import { Prisma } from '@dealflow/database';
import { briefAvailability, builtinHelpKeys, faqsFor, guidesFor, HELP_CATEGORY_BY_ID, HELP_CONTENT_UPDATED, type HelpReader, PRODUCT_BRIEF_BY_ID } from '@dealflow/help';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import {
  HELP_MEDIA_MAX_BYTES,
  type HelpArticleDetail,
  type HelpArticleRow,
  type HelpArticleStats,
  type HelpArticleVersionRow,
  type HelpCategoryEntryRow,
  type HelpContent,
  type HelpContentAudience,
  type HelpFeedbackRow,
  type HelpLocalText,
  type HelpMediaRow,
  type HelpReaderArticle,
  type HelpSettingsView,
  helpSettingsInputSchema,
  helpArticleInputSchema,
  helpCategoryInputSchema,
  helpFeedbackSchema,
} from '@dealflow/types';
import type { z } from 'zod';
import type { AuthContext } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import type { OperatorContext } from '../operator/operator-auth';
import { resolveWorkspaceAccess } from '../workspaces/access';

type Article = Prisma.HelpArticleGetPayload<object>;
type ArticleInput = z.output<typeof helpArticleInputSchema>;

const NO_STATS: HelpArticleStats = { views: 0, helpful: 0, notHelpful: 0 };
/** Files an article may show or link: pictures, short videos and PDFs. */
const MEDIA_TYPES = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|application\/pdf)$/;

const keyOf = (a: { id: string; builtinKey: string | null }) => a.builtinKey ?? `article:${a.id}`;
const invalid = (path: string, message: string) => new BadRequestException({ code: 'VALIDATION_FAILED', message, details: [{ path, message }] });

/**
 * Help Center content (ADR 0073): the Console writes articles, edits or hides built-in help, adds topics and media,
 * and reads feedback; readers get what is published for them, the totals behind "Popular", and can say whether an
 * article helped. Articles and topics are platform-wide, not a workspace's; feedback belongs to the reader's workspace.
 */
@Injectable()
export class HelpContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Readers ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async reader(auth: AuthContext): Promise<HelpReader & { tenantId: string; roleKey: string }> {
    const access = await this.prisma.run(auth, (tx) => resolveWorkspaceAccess(tx, auth.tenantId, auth.workspaceNodeId ?? null));
    return { audience: 'workspace', features: access.features, level: access.level, permissions: auth.permissions, tenantId: auth.tenantId, roleKey: auth.roleKey };
  }

  /** Published articles the reader may see, built-in help the Console hid, topics, totals and the reader's answers. */
  async content(auth: AuthContext): Promise<HelpContent> {
    const [reader, settings] = await Promise.all([this.reader(auth), this.settings(auth)]);
    const base = await this.published('workspace', reader);
    if (!settings.helpEnabled) return { ...base, categories: [], articles: [], stats: {}, myFeedback: {}, settings };
    const mine = await this.prisma.run(auth, (tx) => tx.helpFeedback.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, select: { articleKey: true, helpful: true } }));
    return { ...base, myFeedback: Object.fromEntries(mine.map((f) => [f.articleKey, f.helpful])), settings };
  }

  // ── Settings ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The organisation's Help settings. The Super Workspace's administrators (tenant:manage) may change their part. */
  async settings(auth: AuthContext): Promise<HelpSettingsView> {
    const [row, reader] = await Promise.all([this.prisma.run(auth, (tx) => tx.helpSettings.findUnique({ where: { tenantId: auth.tenantId } })), this.reader(auth)]);
    return toSettings(row, (reader.level ?? 'SUPER') === 'SUPER' && auth.permissions.includes('tenant:manage'));
  }

  async saveSettings(auth: AuthContext, input: z.output<typeof helpSettingsInputSchema>, ip: string | null): Promise<HelpSettingsView> {
    const current = await this.settings(auth);
    if (!current.canManage) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the Super Workspace’s administrators can change Help settings.' });
    const data = { menuVisible: input.menuVisible, explainRestricted: input.explainRestricted, supportNote: input.supportNote?.trim() || null };
    const row = await this.prisma.run(auth, async (tx) => {
      const saved = await tx.helpSettings.upsert({ where: { tenantId: auth.tenantId }, create: { tenantId: auth.tenantId, ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'help.settings_updated', entityType: 'help_settings', entityId: saved.id, metadata: data, meta: { ipAddress: ip, userAgent: null, requestId: '' } });
      return saved;
    });
    return toSettings(row, true);
  }

  /** The Console's view and switch for one client. */
  async clientSettings(tenantId: string): Promise<HelpSettingsView> {
    const row = await this.prisma.run({ tenantId }, async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw notFound('Client');
      return tx.helpSettings.findUnique({ where: { tenantId } });
    });
    return toSettings(row, false);
  }

  async setClientHelp(op: OperatorContext, tenantId: string, helpEnabled: boolean, ip: string | null): Promise<HelpSettingsView> {
    const row = await this.prisma.run({ tenantId }, async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw notFound('Client');
      return tx.helpSettings.upsert({ where: { tenantId }, create: { tenantId, helpEnabled }, update: { helpEnabled } });
    });
    await this.prisma.platformAuditLog.create({ data: { operatorId: op.id, action: 'help_settings.client_updated', targetTenantId: tenantId, metadata: { helpEnabled }, ip } });
    return toSettings(row, false);
  }

  /** The Console's own Help page reads the console audience. */
  async consoleContent(): Promise<HelpContent> {
    return { ...(await this.published('console', null)), myFeedback: {}, settings: toSettings(null, false) };
  }

  private async published(audience: HelpContentAudience, reader: (HelpReader & { tenantId: string; roleKey: string }) | null): Promise<Omit<HelpContent, 'myFeedback' | 'settings'>> {
    const [rows, archived, categories, stats] = await Promise.all([
      this.prisma.helpArticle.findMany({ where: { status: 'PUBLISHED', audience }, orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }] }),
      this.prisma.helpArticle.findMany({ where: { status: 'ARCHIVED', audience, builtinKey: { not: null } }, select: { builtinKey: true } }),
      this.prisma.helpCategoryEntry.findMany({ where: { audience, archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.helpArticleStat.findMany(),
    ]);
    const articles = rows.filter((a) => !reader || visibleTo(a, reader));
    return {
      categories: categories.map(toCategory),
      articles: articles.map(toReaderArticle),
      hidden: archived.map((a) => a.builtinKey!),
      stats: Object.fromEntries(stats.map((s) => [s.articleKey, { views: s.views, helpful: s.helpful, notHelpful: s.notHelpful }])),
      builtinUpdatedAt: new Date(`${HELP_CONTENT_UPDATED}T00:00:00Z`).toISOString(),
    };
  }

  /** Whether the reader can see the article a key names, so feedback and views only count real, visible help. */
  private async readable(auth: AuthContext, key: string): Promise<boolean> {
    if (!(await this.settings(auth)).helpEnabled) return false;
    const reader = await this.reader(auth);
    if (key.startsWith('article:')) {
      const a = await this.prisma.helpArticle.findFirst({ where: { id: key.slice(8), status: 'PUBLISHED', audience: 'workspace' } });
      return !!a && visibleTo(a, reader);
    }
    const override = await this.prisma.helpArticle.findUnique({ where: { builtinKey: key } });
    if (override?.status === 'ARCHIVED') return false;
    if (override?.status === 'PUBLISHED' && visibleTo(override, reader)) return true;
    if (key.startsWith('faq:')) return faqsFor(reader).some((f) => `faq:${f.id}` === key);
    if (key.startsWith('feature:')) {
      const brief = PRODUCT_BRIEF_BY_ID[key.slice(8)];
      return !!brief && (reader.audience === 'console' || briefAvailability(brief, reader) !== 'not-included' || (await this.settings(auth)).explainRestricted);
    }
    return guidesFor(reader).some((g) => `guide:${g.id}` === key);
  }

  /** "Was this helpful?": one answer per person and article, which they may change; the totals follow. */
  async feedback(auth: AuthContext, input: z.output<typeof helpFeedbackSchema>): Promise<{ articleKey: string; helpful: boolean; stats: HelpArticleStats }> {
    if (!(await this.readable(auth, input.articleKey))) throw notFound('Help article');
    const before = await this.prisma.run(auth, async (tx) => {
      const where = { tenantId_userId_articleKey: { tenantId: auth.tenantId, userId: auth.userId, articleKey: input.articleKey } };
      const prev = await tx.helpFeedback.findUnique({ where });
      await tx.helpFeedback.upsert({
        where,
        create: { tenantId: auth.tenantId, userId: auth.userId, articleKey: input.articleKey, helpful: input.helpful, comment: input.comment || null },
        update: { helpful: input.helpful, comment: input.comment === undefined ? prev?.comment : input.comment || null, reviewedAt: null },
      });
      return prev;
    });
    const delta = { helpful: (input.helpful ? 1 : 0) - (before?.helpful === true ? 1 : 0), notHelpful: (input.helpful ? 0 : 1) - (before?.helpful === false ? 1 : 0) };
    const stat = await this.bump(input.articleKey, { helpful: delta.helpful, notHelpful: delta.notHelpful });
    return { articleKey: input.articleKey, helpful: input.helpful, stats: stat };
  }

  /** Counts one reading of an article, for "Popular". Nothing about who read it is kept. */
  async view(auth: AuthContext, key: string): Promise<HelpArticleStats> {
    if (!(await this.readable(auth, key))) throw notFound('Help article');
    return this.bump(key, { views: 1 });
  }

  private async bump(key: string, by: Partial<HelpArticleStats>): Promise<HelpArticleStats> {
    const s = await this.prisma.helpArticleStat.upsert({
      where: { articleKey: key },
      create: { articleKey: key, views: Math.max(0, by.views ?? 0), helpful: Math.max(0, by.helpful ?? 0), notHelpful: Math.max(0, by.notHelpful ?? 0) },
      update: { views: { increment: by.views ?? 0 }, helpful: { increment: by.helpful ?? 0 }, notHelpful: { increment: by.notHelpful ?? 0 } },
    });
    return { views: s.views, helpful: s.helpful, notHelpful: s.notHelpful };
  }

  /** Images and files in articles, for any signed-in reader or operator. */
  async media(id: string): Promise<{ name: string; contentType: string; data: Buffer }> {
    const m = await this.prisma.helpMedia.findUnique({ where: { id } });
    if (!m) throw notFound('File');
    return { name: m.name, contentType: m.contentType, data: Buffer.from(m.data) };
  }

  // ── The Console ──────────────────────────────────────────────────────────────────────────────────────────────────

  async list(q: { status?: string; audience?: string; q?: string }): Promise<HelpArticleRow[]> {
    const rows = await this.prisma.helpArticle.findMany({
      where: { ...(q.status ? { status: q.status as Article['status'] } : {}), ...(q.audience ? { audience: q.audience } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const needle = q.q?.toLowerCase();
    const found = needle ? rows.filter((a) => JSON.stringify([a.title, a.summary, a.builtinKey]).toLowerCase().includes(needle)) : rows;
    return this.rows(found);
  }

  async get(id: string): Promise<HelpArticleDetail> {
    const a = await this.prisma.helpArticle.findUnique({ where: { id } });
    if (!a) throw notFound('Help article');
    const versions = await this.prisma.helpArticleVersion.findMany({ where: { articleId: id }, orderBy: { version: 'desc' } });
    const names = await operatorNames(this.prisma, versions.map((v) => v.operatorId));
    const [row] = await this.rows([a]);
    return {
      ...row!,
      versions: versions.map(
        (v): HelpArticleVersionRow => ({ version: v.version, note: v.note, operator: v.operatorId ? (names.get(v.operatorId) ?? null) : null, createdAt: v.createdAt.toISOString(), snapshot: v.snapshot as unknown as HelpArticleVersionRow['snapshot'] }),
      ),
    };
  }

  async create(op: OperatorContext, input: ArticleInput, ip: string | null): Promise<HelpArticleDetail> {
    await this.checkInput(input);
    if (input.builtinKey && (await this.prisma.helpArticle.findUnique({ where: { builtinKey: input.builtinKey } })))
      throw new ConflictException({ code: 'CONFLICT', message: 'This built-in help already has an edited version. Open that one instead.' });
    const a = await this.prisma.helpArticle.create({ data: { ...fields(input), builtinKey: input.builtinKey ?? null, status: 'DRAFT', version: 1, createdByOperatorId: op.id, updatedByOperatorId: op.id } });
    await this.snapshot(a, op, input.note ?? (input.builtinKey ? 'Copied from the built-in help' : 'First draft'));
    await this.log(op, 'help_article.created', { articleId: a.id, builtinKey: a.builtinKey }, ip);
    return this.get(a.id);
  }

  /** Every save is a new version; a published article stays published with the new text. */
  async update(op: OperatorContext, id: string, input: ArticleInput, ip: string | null): Promise<HelpArticleDetail> {
    const prev = await this.prisma.helpArticle.findUnique({ where: { id } });
    if (!prev) throw notFound('Help article');
    await this.checkInput(input);
    if ((input.builtinKey ?? null) !== prev.builtinKey && input.builtinKey !== undefined) throw invalid('builtinKey', 'The built-in help an article edits cannot change.');
    const a = await this.prisma.helpArticle.update({ where: { id }, data: { ...fields(input), version: prev.version + 1, updatedByOperatorId: op.id } });
    await this.snapshot(a, op, input.note ?? null);
    await this.log(op, 'help_article.updated', { articleId: id, version: a.version }, ip);
    return this.get(id);
  }

  async setStatus(op: OperatorContext, id: string, status: Article['status'], ip: string | null): Promise<HelpArticleDetail> {
    const prev = await this.prisma.helpArticle.findUnique({ where: { id } });
    if (!prev) throw notFound('Help article');
    if (prev.status !== status) {
      await this.prisma.helpArticle.update({ where: { id }, data: { status, updatedByOperatorId: op.id, ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}) } });
      await this.log(op, `help_article.${status === 'PUBLISHED' ? 'published' : status === 'ARCHIVED' ? 'archived' : 'unpublished'}`, { articleId: id, version: prev.version }, ip);
    }
    return this.get(id);
  }

  /** Brings back an earlier version's text as a new version, keeping the history. */
  async restore(op: OperatorContext, id: string, version: number, ip: string | null): Promise<HelpArticleDetail> {
    const [a, v] = await Promise.all([this.prisma.helpArticle.findUnique({ where: { id } }), this.prisma.helpArticleVersion.findUnique({ where: { articleId_version: { articleId: id, version } } })]);
    if (!a || !v) throw notFound('Help article version');
    const snap = v.snapshot as Record<string, unknown>;
    const next = await this.prisma.helpArticle.update({
      where: { id },
      data: {
        kind: snap.kind as Article['kind'],
        categoryId: snap.categoryId as string,
        title: snap.title as Prisma.InputJsonValue,
        summary: snap.summary as Prisma.InputJsonValue,
        body: snap.body as Prisma.InputJsonValue,
        featureKey: (snap.featureKey as string | null) ?? null,
        levels: (snap.levels as string[]) ?? [],
        roleKeys: (snap.roleKeys as string[]) ?? [],
        tenantIds: (snap.tenantIds as string[]) ?? [],
        videoUrl: (snap.videoUrl as string | null) ?? null,
        pinned: !!snap.pinned,
        version: a.version + 1,
        updatedByOperatorId: op.id,
      },
    });
    await this.snapshot(next, op, `Restored version ${version}`);
    await this.log(op, 'help_article.restored', { articleId: id, from: version, version: next.version }, ip);
    return this.get(id);
  }

  async categories(audience?: HelpContentAudience): Promise<HelpCategoryEntryRow[]> {
    const rows = await this.prisma.helpCategoryEntry.findMany({ where: audience ? { audience } : {}, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toCategory);
  }

  /** Adds a topic, or changes one; a subtopic sits under a built-in or Console topic. */
  async saveCategory(op: OperatorContext, input: z.output<typeof helpCategoryInputSchema>, ip: string | null): Promise<HelpCategoryEntryRow> {
    if ((HELP_CATEGORY_BY_ID as Record<string, unknown>)[input.id]) throw invalid('id', 'A built-in topic already uses this id.');
    if (input.parentId && input.parentId === input.id) throw invalid('parentId', 'A topic cannot sit under itself.');
    if (input.parentId && !(HELP_CATEGORY_BY_ID as Record<string, unknown>)[input.parentId] && !(await this.prisma.helpCategoryEntry.findUnique({ where: { id: input.parentId } })))
      throw invalid('parentId', 'refers to a record that does not exist');
    const data = { parentId: input.parentId ?? null, audience: input.audience, title: input.title, description: input.description, icon: input.icon, tone: input.tone, sortOrder: input.sortOrder };
    const row = await this.prisma.helpCategoryEntry.upsert({ where: { id: input.id }, create: { id: input.id, ...data }, update: data });
    await this.log(op, 'help_category.saved', { categoryId: input.id }, ip);
    return toCategory(row);
  }

  async archiveCategory(op: OperatorContext, id: string, archived: boolean, ip: string | null): Promise<HelpCategoryEntryRow> {
    const row = await this.prisma.helpCategoryEntry.findUnique({ where: { id } });
    if (!row) throw notFound('Help topic');
    const next = await this.prisma.helpCategoryEntry.update({ where: { id }, data: { archivedAt: archived ? (row.archivedAt ?? new Date()) : null } });
    await this.log(op, archived ? 'help_category.archived' : 'help_category.restored', { categoryId: id }, ip);
    return toCategory(next);
  }

  async upload(op: OperatorContext, file: { name: string; contentType: string; data: Buffer }, ip: string | null): Promise<HelpMediaRow> {
    if (file.data.length === 0) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file is empty.' });
    if (file.data.length > HELP_MEDIA_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 10 MB.' });
    if (!MEDIA_TYPES.test(file.contentType) || !looksLike(file.data, file.contentType)) throw invalid('file', 'Use a PNG, JPEG, GIF or WebP picture, an MP4 or WebM video, or a PDF.');
    const m = await this.prisma.helpMedia.create({
      data: { name: file.name, contentType: file.contentType, sizeBytes: file.data.length, data: new Uint8Array(file.data), sha256: createHash('sha256').update(file.data).digest('hex'), operatorId: op.id },
    });
    await this.log(op, 'help_media.uploaded', { mediaId: m.id, name: m.name }, ip);
    return toMedia(m);
  }

  async mediaList(): Promise<HelpMediaRow[]> {
    const rows = await this.prisma.helpMedia.findMany({ select: { id: true, name: true, contentType: true, sizeBytes: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(toMedia);
  }

  /** What people said about help, newest first: only the unhappy ones, or only those not reviewed yet, when asked. */
  async feedbackList(q: { articleKey?: string; helpful?: boolean; open?: boolean }): Promise<HelpFeedbackRow[]> {
    return this.prisma.run({ operatorScan: true }, async (tx) => {
      const rows = await tx.helpFeedback.findMany({
        where: { ...(q.articleKey ? { articleKey: q.articleKey } : {}), ...(q.helpful !== undefined ? { helpful: q.helpful } : {}), ...(q.open ? { reviewedAt: null } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 300,
      });
      const [tenants, users] = await Promise.all([
        tx.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } }),
        tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } }),
      ]);
      const tenant = new Map(tenants.map((t) => [t.id, t.name]));
      const user = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => ({
        id: r.id,
        articleKey: r.articleKey,
        helpful: r.helpful,
        comment: r.comment,
        tenant: { id: r.tenantId, name: tenant.get(r.tenantId) ?? '' },
        person: user.get(r.userId) ?? '',
        createdAt: r.updatedAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      }));
    });
  }

  /** Marks a comment as read and dealt with. It runs in the comment's workspace, as other Console changes do. */
  async reviewFeedback(op: OperatorContext, id: string, ip: string | null): Promise<{ id: string; reviewedAt: string }> {
    const row = await this.prisma.run({ operatorScan: true }, (tx) => tx.helpFeedback.findFirst({ where: { id }, select: { tenantId: true } }));
    if (!row) throw notFound('Feedback');
    const done = await this.prisma.run({ tenantId: row.tenantId }, (tx) => tx.helpFeedback.update({ where: { id }, data: { reviewedAt: new Date() } }));
    await this.log(op, 'help_feedback.reviewed', { feedbackId: id }, ip);
    return { id, reviewedAt: done.reviewedAt!.toISOString() };
  }

  private async checkInput(input: ArticleInput) {
    if (input.builtinKey && !builtinHelpKeys().has(input.builtinKey)) throw invalid('builtinKey', 'refers to a record that does not exist');
    if (!(HELP_CATEGORY_BY_ID as Record<string, unknown>)[input.categoryId] && !(await this.prisma.helpCategoryEntry.findUnique({ where: { id: input.categoryId } })))
      throw invalid('categoryId', 'refers to a record that does not exist');
    if (input.tenantIds.length) {
      const found = await this.prisma.run({ operatorScan: true }, (tx) => tx.tenant.count({ where: { id: { in: input.tenantIds } } }));
      if (found !== new Set(input.tenantIds).size) throw invalid('tenantIds', 'refers to a record that does not exist');
    }
    for (const m of JSON.stringify(input.body).matchAll(/media:([0-9a-f-]{36})/g)) {
      if (!(await this.prisma.helpMedia.findUnique({ where: { id: m[1]! }, select: { id: true } }))) throw invalid('body', 'refers to a file that does not exist');
    }
  }

  private async snapshot(a: Article, op: OperatorContext, note: string | null) {
    const snapshot = {
      kind: a.kind,
      categoryId: a.categoryId,
      title: a.title,
      summary: a.summary,
      body: a.body,
      featureKey: a.featureKey,
      levels: a.levels,
      roleKeys: a.roleKeys,
      tenantIds: a.tenantIds,
      videoUrl: a.videoUrl,
      pinned: a.pinned,
      status: a.status,
    };
    await this.prisma.helpArticleVersion.create({ data: { articleId: a.id, version: a.version, snapshot: snapshot as Prisma.InputJsonValue, operatorId: op.id, note } });
  }

  private async rows(list: Article[]): Promise<HelpArticleRow[]> {
    const [stats, names] = await Promise.all([
      this.prisma.helpArticleStat.findMany({ where: { articleKey: { in: list.map(keyOf) } } }),
      operatorNames(this.prisma, list.map((a) => a.updatedByOperatorId)),
    ]);
    const byKey = new Map(stats.map((s) => [s.articleKey, { views: s.views, helpful: s.helpful, notHelpful: s.notHelpful }]));
    return list.map((a) => ({
      id: a.id,
      key: keyOf(a),
      kind: a.kind,
      builtinKey: a.builtinKey,
      audience: a.audience as HelpContentAudience,
      categoryId: a.categoryId,
      title: a.title as HelpLocalText,
      summary: a.summary as HelpLocalText,
      body: a.body as HelpLocalText,
      featureKey: a.featureKey,
      levels: a.levels,
      roleKeys: a.roleKeys,
      tenantIds: a.tenantIds,
      videoUrl: a.videoUrl,
      pinned: a.pinned,
      status: a.status,
      version: a.version,
      publishedAt: a.publishedAt?.toISOString() ?? null,
      updatedAt: a.updatedAt.toISOString(),
      updatedBy: a.updatedByOperatorId ? (names.get(a.updatedByOperatorId) ?? null) : null,
      stats: byKey.get(keyOf(a)) ?? NO_STATS,
    }));
  }

  private async log(op: OperatorContext, action: string, metadata: Record<string, unknown>, ip: string | null) {
    await this.prisma.platformAuditLog.create({ data: { operatorId: op.id, action, targetTenantId: null, metadata: metadata as Prisma.InputJsonValue, ip } });
  }
}

function fields(input: ArticleInput) {
  return {
    kind: input.kind,
    audience: input.audience,
    categoryId: input.categoryId,
    title: input.title as Prisma.InputJsonValue,
    summary: input.summary as Prisma.InputJsonValue,
    body: input.body as Prisma.InputJsonValue,
    featureKey: input.featureKey ?? null,
    levels: [...new Set(input.levels)],
    roleKeys: [...new Set(input.roleKeys)],
    tenantIds: [...new Set(input.tenantIds)],
    videoUrl: input.videoUrl ?? null,
    pinned: input.pinned,
  };
}

/** Plan or workspace features, workspace level, role and organisation, as the Console set them on the article. */
function visibleTo(a: Article, reader: HelpReader & { tenantId: string; roleKey: string }): boolean {
  if (a.featureKey && !(reader.features ?? []).includes(a.featureKey as never)) return false;
  if (a.levels.length && !a.levels.includes(reader.level ?? 'SUPER')) return false;
  if (a.roleKeys.length && !a.roleKeys.includes(reader.roleKey)) return false;
  if (a.tenantIds.length && !a.tenantIds.includes(reader.tenantId)) return false;
  return true;
}

function toSettings(row: { helpEnabled: boolean; menuVisible: boolean; explainRestricted: boolean; supportNote: string | null; updatedAt: Date } | null, canManage: boolean): HelpSettingsView {
  return {
    helpEnabled: row?.helpEnabled ?? true,
    menuVisible: row?.menuVisible ?? true,
    explainRestricted: row?.explainRestricted ?? true,
    supportNote: row?.supportNote ?? null,
    canManage,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function toReaderArticle(a: Article): HelpReaderArticle {
  return {
    key: keyOf(a),
    id: a.id,
    kind: a.kind,
    builtinKey: a.builtinKey,
    categoryId: a.categoryId,
    title: a.title as HelpLocalText,
    summary: a.summary as HelpLocalText,
    body: a.body as HelpLocalText,
    featureKey: a.featureKey,
    videoUrl: a.videoUrl,
    pinned: a.pinned,
    updatedAt: a.updatedAt.toISOString(),
  };
}

function toCategory(c: Prisma.HelpCategoryEntryGetPayload<object>): HelpCategoryEntryRow {
  return {
    id: c.id,
    parentId: c.parentId,
    audience: c.audience as HelpContentAudience,
    title: c.title as HelpLocalText,
    description: c.description as HelpLocalText,
    icon: c.icon,
    tone: c.tone,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt?.toISOString() ?? null,
  };
}

/** The file's first bytes must match the type it claims, so a renamed file of another kind is refused. */
function looksLike(data: Buffer, type: string): boolean {
  const hex = data.subarray(0, 12).toString('hex');
  const ascii = data.subarray(0, 12).toString('latin1');
  switch (type) {
    case 'image/png':
      return hex.startsWith('89504e470d0a1a0a');
    case 'image/jpeg':
      return hex.startsWith('ffd8ff');
    case 'image/gif':
      return ascii.startsWith('GIF8');
    case 'image/webp':
      return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case 'video/mp4':
      return ascii.slice(4, 8) === 'ftyp';
    case 'video/webm':
      return hex.startsWith('1a45dfa3');
    case 'application/pdf':
      return ascii.startsWith('%PDF-');
    default:
      return false;
  }
}

function toMedia(m: { id: string; name: string; contentType: string; sizeBytes: number }): HelpMediaRow {
  return { id: m.id, name: m.name, contentType: m.contentType, sizeBytes: m.sizeBytes, markdown: `![${m.name.replace(/[[\]]/g, '')}](media:${m.id})` };
}

async function operatorNames(prisma: PrismaService, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const ops = await prisma.platformOperator.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(ops.map((o) => [o.id, o.name]));
}
