'use client';

import {
  type BriefAvailability,
  type BriefKind,
  briefAvailability,
  briefHref,
  faqsFor,
  foldText,
  guidesFor,
  HELP_CATEGORIES,
  type HelpFaq,
  type HelpGuide,
  type HelpReader,
  helpText,
  PRODUCT_BRIEFS,
} from '@dealflow/help';
import {
  type FeatureKey,
  type HelpArticleStats,
  type HelpContent,
  type HelpReaderArticle,
  type HelpSettingsInput,
  type HelpSettingsView,
  type LanguageCode,
  localText,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/*
 * The Help Center's content (ADR 0073): the built-in answers and guides shipped with the app, with what the Console
 * wrote on top — new articles, edited or hidden built-in ones, topics and subtopics, announcements — and the totals
 * and answers behind "Popular" and "Was this helpful?".
 */

export const helpContentKeys = {
  workspace: ['help', 'content', 'workspace'] as const,
  console: ['help', 'content', 'console'] as const,
};

export function useHelpContent(audience: 'workspace' | 'console' | undefined) {
  return useQuery({
    enabled: !!audience,
    queryKey: audience === 'console' ? helpContentKeys.console : helpContentKeys.workspace,
    queryFn: () =>
      api<HelpContent>(audience === 'console' ? '/operator/help/content' : '/help/content'),
    staleTime: 60_000,
  });
}

/** The organisation's Help settings (the Console's switch and the Super Workspace's choices). */
export function useHelpSettings(enabled = true) {
  return useQuery({ enabled, queryKey: ['help', 'settings'], queryFn: () => api<HelpSettingsView>('/help/settings'), staleTime: 60_000 });
}

export function useSaveHelpSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HelpSettingsInput) => api<HelpSettingsView>('/help/settings', { method: 'PUT', json: input }),
    onSuccess: (s) => {
      qc.setQueryData(['help', 'settings'], s);
      void qc.invalidateQueries({ queryKey: ['help', 'content'] });
    },
  });
}

export function useHelpFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { articleKey: string; helpful: boolean; comment?: string | null }) =>
      api<{ articleKey: string; helpful: boolean; stats: HelpArticleStats }>('/help/feedback', {
        method: 'POST',
        json: input,
      }),
    onSuccess: (r) =>
      qc.setQueryData<HelpContent>(helpContentKeys.workspace, (c) =>
        c
          ? {
              ...c,
              stats: { ...c.stats, [r.articleKey]: r.stats },
              myFeedback: { ...c.myFeedback, [r.articleKey]: r.helpful },
            }
          : c,
      ),
  });
}

/** Counts an opened answer or guide once per page visit, for "Popular". Failures are ignored: reading still works. */
const counted = new Set<string>();
export function countHelpView(key: string) {
  if (counted.has(key)) return;
  counted.add(key);
  void api('/help/views', { method: 'POST', json: { articleKey: key } }).catch(() =>
    counted.delete(key),
  );
}

/** Where an article's pictures come from: the reader's route, or the Console's own. */
export function helpMediaHref(id: string, audience: 'workspace' | 'console'): string {
  return audience === 'console' ? `/api/v1/operator/help/media/${id}` : `/api/v1/help/media/${id}`;
}

/** A topic tile, in the reader's language. */
export interface ViewCategory {
  id: string;
  parentId: string | null;
  icon: string;
  tone: number;
  title: string;
  description: string;
}

/** A question and answer: built-in, or written in the Console (which may replace a built-in one). */
export interface ViewFaq {
  key: string;
  /** The id that tests and links use: the built-in id, or the article key. */
  id: string;
  category: string;
  q: string;
  a: string;
  /** More detail, as simple Markdown (Console articles only). */
  body: string;
  videoUrl: string | null;
  guide?: HelpGuide;
  updatedAt: string;
  english: string;
}

/** A feature guide: the built-in page guide, or a Console guide or article. */
export interface ViewGuide {
  key: string;
  id: string;
  category: string;
  title: string;
  what: string;
  body: string;
  videoUrl: string | null;
  /** The built-in page guide this is, or replaces, with its steps, sections and page link. */
  builtin?: HelpGuide;
  updatedAt: string;
  english: string;
}

/** A brief under Explore SampForce: built-in, edited in the Console, or the Console's own (kind FEATURE). */
export interface ViewBrief {
  key: string;
  id: string;
  kind: BriefKind;
  category: string;
  icon: string;
  tone: number;
  title: string;
  tagline: string;
  summary: string;
  highlights: string[];
  /** More detail, as simple Markdown (Console articles only). */
  body: string;
  videoUrl: string | null;
  features: readonly FeatureKey[];
  guides: readonly string[];
  availability: BriefAvailability;
  /** The brief's features the reader may use now (all of them in the Console). */
  included: readonly FeatureKey[];
  /** Where the feature opens in the app, when the reader has it. */
  href: string | null;
  updatedAt: string;
  english: string;
}

export interface HelpView {
  categories: ViewCategory[];
  faqs: ViewFaq[];
  guides: ViewGuide[];
  /** Explore SampForce: the parts of the product and its facilities. */
  briefs: ViewBrief[];
  announcements: {
    key: string;
    title: string;
    summary: string;
    body: string;
    updatedAt: string;
    videoUrl: string | null;
  }[];
  stats: HelpContent['stats'];
  myFeedback: HelpContent['myFeedback'];
}

/** The built-in help as the reader may see it, merged with the Console's content. */
export function buildHelpView(
  reader: HelpReader,
  content: HelpContent | undefined,
  language: LanguageCode,
  title: (english: string) => string,
): HelpView {
  const builtinUpdated = content?.builtinUpdatedAt ?? new Date(0).toISOString();
  const hidden = new Set(content?.hidden ?? []);
  const articles = content?.articles ?? [];
  const overrides = new Map(articles.filter((a) => a.builtinKey).map((a) => [a.builtinKey!, a]));
  const allFaqs = faqsFor(reader);
  const allGuides = guidesFor(reader);
  const guideById = new Map(allGuides.map((g) => [g.id as string, g]));

  const fromArticleFaq = (a: HelpReaderArticle, builtin?: HelpFaq): ViewFaq => ({
    key: a.key,
    id: builtin?.id ?? a.key,
    category: a.categoryId,
    q: localText(a.title, language),
    a: localText(a.summary, language),
    body: localText(a.body, language),
    videoUrl: a.videoUrl,
    guide: builtin?.guide ? guideById.get(builtin.guide) : undefined,
    updatedAt: a.updatedAt,
    english: [a.title.en, a.summary.en, a.body.en].join(' '),
  });
  const fromArticleGuide = (a: HelpReaderArticle, builtin?: HelpGuide): ViewGuide => ({
    key: a.key,
    id: builtin?.id ?? a.key,
    category: a.categoryId,
    title: localText(a.title, language),
    what: localText(a.summary, language),
    body: localText(a.body, language),
    videoUrl: a.videoUrl,
    builtin,
    updatedAt: a.updatedAt,
    english: [a.title.en, a.summary.en, a.body.en].join(' '),
  });

  const faqs: ViewFaq[] = [];
  for (const f of allFaqs) {
    const key = `faq:${f.id}`;
    if (hidden.has(key)) continue;
    const o = overrides.get(key);
    if (o) faqs.push(fromArticleFaq(o, f));
    else
      faqs.push({
        key,
        id: f.id,
        category: f.category,
        q: helpText(f.q, language),
        a: helpText(f.a, language),
        body: '',
        videoUrl: null,
        guide: f.guide ? guideById.get(f.guide) : undefined,
        updatedAt: builtinUpdated,
        english: `${f.q[0]} ${f.a[0]}`,
      });
  }
  const guides: ViewGuide[] = [];
  for (const g of allGuides) {
    const key = `guide:${g.id}`;
    if (hidden.has(key)) continue;
    const o = overrides.get(key);
    if (o) guides.push(fromArticleGuide(o, g));
    else
      guides.push({
        key,
        id: g.id,
        category: g.category,
        title: title(g.topic.title),
        what: helpText(g.topic.what, language),
        body: '',
        videoUrl: null,
        builtin: g,
        updatedAt: builtinUpdated,
        english: [
          g.topic.title,
          g.topic.what[0],
          g.topic.how[0],
          g.topic.where[0],
          ...g.sections.map((s) => `${s.topic.title} ${s.topic.what[0]}`),
        ].join(' '),
      });
  }
  for (const a of articles) {
    if (a.builtinKey) continue;
    if (a.kind === 'FAQ') faqs.push(fromArticleFaq(a));
    if (a.kind === 'GUIDE') guides.push(fromArticleGuide(a));
  }
  const pinnedFirst = <T extends { key: string }>(list: T[]) => {
    const pinned = new Set(articles.filter((a) => a.pinned).map((a) => a.key));
    return [...list.filter((x) => pinned.has(x.key)), ...list.filter((x) => !pinned.has(x.key))];
  };

  // Topics: the built-in ones in use, then the Console's (a subtopic after its parent), keeping only those with content.
  const used = new Set([...faqs.map((f) => f.category), ...guides.map((g) => g.category)]);
  const custom = (content?.categories ?? []).filter((c) => c.audience === reader.audience);
  const categories: ViewCategory[] = [
    ...HELP_CATEGORIES.filter((c) => c.audience === reader.audience).map((c) => ({
      id: c.id,
      parentId: null,
      icon: c.icon,
      tone: c.tone,
      title: helpText(c.title, language),
      description: helpText(c.description, language),
    })),
    ...custom.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      icon: c.icon,
      tone: c.tone,
      title: localText(c.title, language),
      description: localText(c.description, language),
    })),
  ];
  const withContent = (id: string): boolean =>
    used.has(id) || categories.some((c) => c.parentId === id && withContent(c.id));
  const kept = categories.filter((c) => withContent(c.id));
  const ordered: ViewCategory[] = [];
  for (const c of kept.filter((c) => !c.parentId || !kept.some((p) => p.id === c.parentId))) {
    ordered.push(c);
    ordered.push(...kept.filter((s) => s.parentId === c.id));
  }

  // Explore SampForce. A part the plan leaves out shows only while the Super Workspace explains such features.
  const explain = reader.audience === 'console' || (content?.settings?.explainRestricted ?? true);
  const mayUse = (list: readonly FeatureKey[]) => (reader.audience === 'console' ? list : list.filter((f) => reader.features?.includes(f)));
  const briefs: ViewBrief[] = [];
  for (const b of PRODUCT_BRIEFS) {
    const key = `feature:${b.id}`;
    if (hidden.has(key)) continue;
    const availability = briefAvailability(b, reader);
    if (availability === 'not-included' && !explain) continue;
    const o = overrides.get(key);
    briefs.push({
      key,
      id: b.id,
      kind: b.kind,
      category: o?.categoryId ?? b.category,
      icon: b.icon,
      tone: b.tone,
      title: o ? localText(o.title, language) : helpText(b.title, language),
      tagline: helpText(b.tagline, language),
      summary: o ? localText(o.summary, language) : helpText(b.summary, language),
      highlights: b.highlights.map((h) => helpText(h, language)),
      body: o ? localText(o.body, language) : '',
      videoUrl: o?.videoUrl ?? null,
      features: b.features,
      guides: b.guides,
      availability,
      included: mayUse(b.features),
      href: briefHref(b, reader),
      updatedAt: o?.updatedAt ?? builtinUpdated,
      english: o ? [o.title.en, o.summary.en, o.body.en].join(' ') : [b.title[0], b.tagline[0], b.summary[0], ...b.highlights.map((h) => h[0])].join(' '),
    });
  }
  for (const a of articles) {
    if (a.builtinKey || a.kind !== 'FEATURE') continue;
    const features = a.featureKey ? [a.featureKey as FeatureKey] : [];
    const availability = briefAvailability({ features }, reader);
    if (availability === 'not-included' && !explain) continue;
    briefs.push({
      key: a.key,
      id: a.key,
      kind: 'feature',
      category: a.categoryId,
      icon: HELP_CATEGORIES.find((c) => c.id === a.categoryId)?.icon ?? 'sparkles',
      tone: HELP_CATEGORIES.find((c) => c.id === a.categoryId)?.tone ?? 1,
      title: localText(a.title, language),
      tagline: '',
      summary: localText(a.summary, language),
      highlights: [],
      body: localText(a.body, language),
      videoUrl: a.videoUrl,
      features,
      guides: [],
      availability,
      included: mayUse(features),
      href: briefHref({ features }, reader),
      updatedAt: a.updatedAt,
      english: [a.title.en, a.summary.en, a.body.en].join(' '),
    });
  }

  return {
    categories: ordered,
    faqs: pinnedFirst(faqs),
    guides: pinnedFirst(guides),
    briefs: pinnedFirst(briefs),
    announcements: articles
      .filter((a) => a.kind === 'ANNOUNCEMENT')
      .map((a) => ({
        key: a.key,
        title: localText(a.title, language),
        summary: localText(a.summary, language),
        body: localText(a.body, language),
        updatedAt: a.updatedAt,
        videoUrl: a.videoUrl,
      })),
    stats: content?.stats ?? {},
    myFeedback: content?.myFeedback ?? {},
  };
}

export type ViewHit =
  | { kind: 'faq'; item: ViewFaq; score: number }
  | { kind: 'guide'; item: ViewGuide; score: number };

/**
 * Searches as the person types: every word must appear, and part of a word is enough ("impo" finds "import"). The
 * reader's language and English both match; a title counts more than the text under it.
 */
export function searchView(view: HelpView, query: string): ViewHit[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const score = (strong: string, weak: string): number => {
    const s = foldText(strong);
    const w = foldText(weak);
    let total = 0;
    for (const word of words) {
      if (s.includes(word)) total += s.split(' ').some((x) => x.startsWith(word)) ? 4 : 3;
      else if (w.includes(word)) total += 1;
      else return 0;
    }
    return total;
  };
  const hits: ViewHit[] = [];
  for (const f of view.faqs) {
    const n = score(f.q, `${f.a} ${f.body} ${f.english}`);
    if (n) hits.push({ kind: 'faq', item: f, score: n });
  }
  for (const g of view.guides) {
    const sections = g.builtin ? g.builtin.sections.map((s) => s.topic.title).join(' ') : '';
    const n = score(g.title, `${g.what} ${g.body} ${sections} ${g.english}`);
    if (n) hits.push({ kind: 'guide', item: g, score: n });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Briefs whose words all appear in them, best match first (the same partial matching as searchView). */
export function searchBriefs(view: HelpView, query: string): ViewBrief[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: [ViewBrief, number][] = [];
  for (const b of view.briefs) {
    const strong = foldText(b.title);
    const weak = foldText(`${b.tagline} ${b.summary} ${b.highlights.join(' ')} ${b.body} ${b.english}`);
    let total = 0;
    for (const w of words) {
      if (strong.includes(w)) total += 3;
      else if (weak.includes(w)) total += 1;
      else {
        total = 0;
        break;
      }
    }
    if (total) scored.push([b, total]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([b]) => b);
}

/** The most read and most helpful answers and guides, from everyone's totals. */
export function popular(view: HelpView, limit = 6): (ViewFaq | ViewGuide)[] {
  const rank = (key: string) => {
    const s = view.stats[key];
    return s ? s.views + s.helpful * 3 - s.notHelpful : 0;
  };
  return [...view.faqs, ...view.guides]
    .filter((x) => rank(x.key) > 0)
    .sort((a, b) => rank(b.key) - rank(a.key))
    .slice(0, limit);
}

/** Answers and guides the Console wrote or changed, newest first. */
export function recentlyUpdated(
  view: HelpView,
  builtinUpdatedAt: string | undefined,
  limit = 6,
): (ViewFaq | ViewGuide)[] {
  return [...view.faqs, ...view.guides]
    .filter((x) => x.key.startsWith('article:') || x.updatedAt !== builtinUpdatedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function isFaq(x: ViewFaq | ViewGuide): x is ViewFaq {
  return 'q' in x;
}

/** One block of an article body: the small Markdown the Console editor writes. */
export type BodyBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'media'; id: string; caption: string }
  | { type: 'tip'; text: string };

/**
 * Reads the article body: "## " headings, "1. " numbered steps, "- " bullets, "> " tips, ![caption](media:<id>)
 * pictures and plain paragraphs. Nothing is ever read as HTML.
 */
export function parseBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ') });
    para = [];
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const media = line.match(/^!\[([^\]]*)\]\(media:([0-9a-f-]{36})\)$/i);
    const step = line.match(/^\d+[.)]\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (line.startsWith('#')) {
      flush();
      blocks.push({ type: 'heading', text: line.replace(/^#+\s*/, '') });
    } else if (media) {
      flush();
      blocks.push({ type: 'media', id: media[2]!.toLowerCase(), caption: media[1]! });
    } else if (step || bullet) {
      flush();
      const type = step ? 'steps' : 'bullets';
      const text = (step ?? bullet)![1]!;
      const last = blocks.at(-1);
      if (last && last.type === type) last.items.push(text);
      else blocks.push({ type, items: [text] });
    } else if (line.startsWith('>')) {
      flush();
      blocks.push({ type: 'tip', text: line.replace(/^>\s*/, '') });
    } else para.push(line);
  }
  flush();
  return blocks;
}
