import { z } from 'zod';
import { featureKeySchema } from './features';

/*
 * Help Center content managed in the Console (ADR 0073). Built-in answers and guides ship with the app
 * (packages/help); the Console writes new articles, edits or hides built-in ones, sorts them into topics, and reads
 * what people said about them. Text is kept per language; a language left empty falls back to English.
 */

/** FEATURE: a brief about a part of SampForce, its offering or a facility, shown under Explore SampForce. */
export const HELP_ARTICLE_KINDS = ['FAQ', 'GUIDE', 'ANNOUNCEMENT', 'FEATURE'] as const;
export type HelpArticleKind = (typeof HELP_ARTICLE_KINDS)[number];
export const HELP_ARTICLE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type HelpArticleStatus = (typeof HELP_ARTICLE_STATUSES)[number];
export const HELP_AUDIENCES = ['workspace', 'console'] as const;
export type HelpContentAudience = (typeof HELP_AUDIENCES)[number];
export const HELP_LEVELS = ['SUPER', 'MANAGER', 'EXECUTIVE'] as const;

export const HELP_TITLE_MAX = 200;
export const HELP_SUMMARY_MAX = 1000;
export const HELP_BODY_MAX = 20_000;
export const HELP_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/**
 * An article's key everywhere (stats, feedback, links): faq:<id>, guide:<page id> or feature:<brief id> for built-in
 * help, article:<id> for the Console's own.
 */
export const HELP_ARTICLE_KEY = /^(faq:[a-z][\w.]{1,60}|guide:page\.[\w.]{1,60}|feature:[a-z][\w-]{1,60}|article:[0-9a-f-]{36})$/i;

const text = (max: number, required: boolean) => {
  const en = required ? z.string().trim().min(1).max(max) : z.string().trim().max(max).default('');
  const other = z.string().trim().max(max).optional();
  return z.object({ en, es: other, fr: other, de: other, ar: other });
};
export type HelpLocalText = { en: string; es?: string; fr?: string; de?: string; ar?: string };

/** Picks the reader's language, falling back to English. */
export function localText(t: HelpLocalText | null | undefined, language: string): string {
  if (!t) return '';
  const v = (t as Record<string, string | undefined>)[language];
  return v && v.trim() ? v : t.en;
}

export const helpArticleInputSchema = z.object({
  kind: z.enum(HELP_ARTICLE_KINDS),
  /** Set to edit a built-in answer or guide instead of writing a new article. */
  builtinKey: z
    .string()
    .regex(/^(faq:[a-z][\w.]{1,60}|guide:page\.[\w.]{1,60}|feature:[a-z][\w-]{1,60})$/i)
    .nullable()
    .optional(),
  audience: z.enum(HELP_AUDIENCES).default('workspace'),
  categoryId: z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/),
  title: text(HELP_TITLE_MAX, true),
  summary: text(HELP_SUMMARY_MAX, true),
  body: text(HELP_BODY_MAX, false),
  featureKey: featureKeySchema.nullable().optional(),
  levels: z.array(z.enum(HELP_LEVELS)).max(3).default([]),
  roleKeys: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  tenantIds: z.array(z.string().uuid()).max(200).default([]),
  videoUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https:\/\//.test(u), 'Use an https:// address.')
    .nullable()
    .optional(),
  pinned: z.boolean().default(false),
  /** What changed, kept with the version. */
  note: z.string().trim().max(300).optional(),
});
export type HelpArticleInput = z.input<typeof helpArticleInputSchema>;

export const helpArticleListQuerySchema = z.object({
  status: z.enum(HELP_ARTICLE_STATUSES).optional(),
  audience: z.enum(HELP_AUDIENCES).optional(),
  q: z.string().trim().max(120).optional(),
});

export const helpCategoryInputSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/),
  parentId: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,39}$/)
    .nullable()
    .optional(),
  audience: z.enum(HELP_AUDIENCES).default('workspace'),
  title: text(80, true),
  description: text(300, false),
  icon: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,39}$/)
    .default('book-open'),
  tone: z.number().int().min(1).max(6).default(1),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});
export type HelpCategoryInput = z.input<typeof helpCategoryInputSchema>;

export const helpFeedbackSchema = z.object({
  articleKey: z.string().regex(HELP_ARTICLE_KEY),
  helpful: z.boolean(),
  comment: z.string().trim().max(1000).nullable().optional(),
});
export type HelpFeedbackInput = z.input<typeof helpFeedbackSchema>;

export const helpViewSchema = z.object({ articleKey: z.string().regex(HELP_ARTICLE_KEY) });

export interface HelpArticleStats {
  views: number;
  helpful: number;
  notHelpful: number;
}

/** A published article as a reader receives it. */
export interface HelpReaderArticle {
  key: string;
  id: string;
  kind: HelpArticleKind;
  builtinKey: string | null;
  categoryId: string;
  title: HelpLocalText;
  summary: HelpLocalText;
  body: HelpLocalText;
  featureKey: string | null;
  videoUrl: string | null;
  pinned: boolean;
  updatedAt: string;
}

export interface HelpCategoryEntryRow {
  id: string;
  parentId: string | null;
  audience: HelpContentAudience;
  title: HelpLocalText;
  description: HelpLocalText;
  icon: string;
  tone: number;
  sortOrder: number;
  archivedAt: string | null;
}

/** What a reader's Help Center adds to the built-in help: the Console's articles, topics and the totals. */
export interface HelpContent {
  categories: HelpCategoryEntryRow[];
  articles: HelpReaderArticle[];
  /** Built-in answers and guides the Console archived. */
  hidden: string[];
  /** Totals across everyone, for "Popular". */
  stats: Record<string, HelpArticleStats>;
  /** When the built-in help was last revised. */
  builtinUpdatedAt: string;
  /** The reader's own "Was this helpful?" answers, so the question shows what they said. */
  myFeedback: Record<string, boolean>;
  /** The organisation's Help settings; with help switched off by the Console, no answers or guides are sent. */
  settings: HelpSettingsView;
}

export interface HelpArticleRow {
  id: string;
  key: string;
  kind: HelpArticleKind;
  builtinKey: string | null;
  audience: HelpContentAudience;
  categoryId: string;
  title: HelpLocalText;
  summary: HelpLocalText;
  body: HelpLocalText;
  featureKey: string | null;
  levels: string[];
  roleKeys: string[];
  tenantIds: string[];
  videoUrl: string | null;
  pinned: boolean;
  status: HelpArticleStatus;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
  stats: HelpArticleStats;
}

export interface HelpArticleVersionRow {
  version: number;
  note: string | null;
  operator: string | null;
  createdAt: string;
  snapshot: Pick<HelpArticleRow, 'kind' | 'categoryId' | 'title' | 'summary' | 'body' | 'featureKey' | 'levels' | 'roleKeys' | 'tenantIds' | 'videoUrl' | 'pinned' | 'status'>;
}

export interface HelpArticleDetail extends HelpArticleRow {
  versions: HelpArticleVersionRow[];
}

export interface HelpMediaRow {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** For an article body: ![caption](media:<id>). */
  markdown: string;
}

export interface HelpFeedbackRow {
  id: string;
  articleKey: string;
  helpful: boolean;
  comment: string | null;
  tenant: { id: string; name: string };
  person: string;
  createdAt: string;
  reviewedAt: string | null;
}

/** Help & Support settings of an organisation: the Console's switch and the Super Workspace's choices. */
export interface HelpSettingsView {
  /** The Console allows the Help Center's answers and guides for this client. */
  helpEnabled: boolean;
  menuVisible: boolean;
  explainRestricted: boolean;
  supportNote: string | null;
  /** Whether the reader may change the Super Workspace's choices. */
  canManage: boolean;
  updatedAt: string | null;
}

export const helpSettingsInputSchema = z.object({
  menuVisible: z.boolean(),
  explainRestricted: z.boolean(),
  supportNote: z.string().trim().max(500).nullable().optional(),
});
export type HelpSettingsInput = z.input<typeof helpSettingsInputSchema>;

export const operatorHelpSettingsSchema = z.object({ helpEnabled: z.boolean() });
