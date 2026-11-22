import { FEATURE_KEYS, PERMISSIONS } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_FAQS,
  GUIDE_CATEGORY,
  HELP_CATEGORIES,
  HELP_FAQS,
  HELP_TOPICS,
  HIDDEN_GUIDES,
  type HelpId,
  type HelpReader,
  type HelpText,
  allGuides,
  categoriesFor,
  faqsFor,
  foldText,
  guideFeature,
  guideHref,
  guidesFor,
  searchHelp,
} from './index';

const ALL = [...HELP_FAQS, ...CONSOLE_FAQS];

function fiveLanguages(row: HelpText, label: string) {
  expect(row, label).toHaveLength(5);
  for (const text of row) expect(text.trim(), label).not.toBe('');
  for (const text of row.slice(1)) expect(text, `${label} is untranslated`).not.toBe(row[0]);
  expect(row[4], `${label} Arabic`).toMatch(/[؀-ۿ]/);
}

describe('help center content', () => {
  it('writes every category and question in all five languages', () => {
    for (const c of HELP_CATEGORIES) {
      fiveLanguages(c.title, `${c.id}.title`);
      fiveLanguages(c.description, `${c.id}.description`);
    }
    for (const q of ALL) {
      fiveLanguages(q.q, `${q.id}.q`);
      fiveLanguages(q.a, `${q.id}.a`);
    }
  });

  it('gives every question a unique id, a known category for its audience and real rules', () => {
    expect(new Set(ALL.map((q) => q.id)).size).toBe(ALL.length);
    const audience = new Map(HELP_CATEGORIES.map((c) => [c.id, c.audience]));
    for (const q of HELP_FAQS) expect(audience.get(q.category), q.id).toBe('workspace');
    for (const q of CONSOLE_FAQS) expect(audience.get(q.category), q.id).toBe('console');
    for (const q of ALL) {
      if (q.feature) expect(FEATURE_KEYS, q.id).toContain(q.feature);
      if (q.permission) expect(PERMISSIONS, q.id).toContain(q.permission);
      if (q.guide) expect(HELP_TOPICS[q.guide], q.id).toBeDefined();
    }
  });

  it('keeps answers short enough to read at a glance', () => {
    for (const q of ALL) for (const text of q.a) expect(text.length, `${q.id}: ${text}`).toBeLessThanOrEqual(420);
  });

  it('puts every page in exactly one guide category, except pages that have not shipped', () => {
    const pages = (Object.keys(HELP_TOPICS) as HelpId[]).filter((id) => id.startsWith('page.'));
    expect(pages.filter((id) => !GUIDE_CATEGORY[id] && !HIDDEN_GUIDES.includes(id))).toEqual([]);
    expect(Object.keys(GUIDE_CATEGORY).filter((id) => !(id in HELP_TOPICS))).toEqual([]);
  });

  it('answers at least one question in every category', () => {
    for (const c of HELP_CATEGORIES) expect(ALL.some((q) => q.category === c.id), c.id).toBe(true);
  });

  it('links pages to their address and plan feature', () => {
    expect(guideHref('page.deals')).toBe('/app/deals');
    expect(guideHref('page.dealRecord')).toBeUndefined();
    expect(guideFeature('page.sequences')).toBe('sequences');
    expect(guideFeature('page.sequenceEditor')).toBe('sequences');
    expect(guideFeature('page.commandCenter')).toBeNull();
    expect(allGuides().find((g) => g.id === 'page.deals')?.sections.length).toBeGreaterThan(0);
  });
});

describe('who sees what', () => {
  const everything: HelpReader = { audience: 'workspace', features: [...FEATURE_KEYS], level: 'SUPER', permissions: [...PERMISSIONS] };

  it('shows only guides and questions for features the workspace has', () => {
    const without: HelpReader = { ...everything, features: FEATURE_KEYS.filter((f) => f !== 'sequences' && f !== 'rfqs') };
    expect(guidesFor(everything).map((g) => g.id)).toContain('page.sequences');
    expect(guidesFor(without).map((g) => g.id)).not.toContain('page.sequences');
    expect(guidesFor(without).map((g) => g.id)).not.toContain('page.rfqs');
    expect(faqsFor(without).map((q) => q.id)).not.toContain('outreach.sequence');
    expect(faqsFor(without).map((q) => q.id)).not.toContain('deals.rfq');
    expect(faqsFor(without).map((q) => q.id)).toContain('start.search');
  });

  it('follows the workspace level', () => {
    const executive: HelpReader = { ...everything, level: 'EXECUTIVE' };
    expect(guidesFor(executive).map((g) => g.id)).not.toContain('page.workspaces');
    expect(faqsFor(executive).map((q) => q.id)).not.toContain('workspaces.permissionCenter');
    expect(faqsFor({ ...everything, level: 'MANAGER' }).map((q) => q.id)).toContain('workspaces.permissionCenter');
    // No level yet means the Super Workspace.
    expect(faqsFor({ ...everything, level: null }).map((q) => q.id)).toContain('workspaces.permissionCenter');
  });

  it('follows the role', () => {
    const viewer: HelpReader = { ...everything, permissions: PERMISSIONS.filter((p) => p.endsWith(':read') && p !== 'billing:read') };
    expect(guidesFor(viewer).map((g) => g.id)).not.toContain('page.billing');
    expect(faqsFor(viewer).map((q) => q.id)).not.toContain('billing.plan');
    expect(faqsFor(viewer).map((q) => q.id)).not.toContain('workspaces.invite');
  });

  it('keeps the console and workspaces apart', () => {
    const console: HelpReader = { audience: 'console' };
    expect(faqsFor(console)).toEqual(CONSOLE_FAQS);
    expect(guidesFor(console).every((g) => g.id.startsWith('page.operator') || g.id.startsWith('page.console'))).toBe(true);
    expect(guidesFor(everything).some((g) => g.id.startsWith('page.operator'))).toBe(false);
    expect(categoriesFor(console).every((c) => c.audience === 'console')).toBe(true);
  });

  it('hides a category with nothing left in it', () => {
    const bare: HelpReader = { audience: 'workspace', features: [], level: 'EXECUTIVE', permissions: [] };
    const ids = categoriesFor(bare).map((c) => c.id);
    expect(ids).toContain('start');
    expect(ids).not.toContain('documents');
  });
});

describe('help search', () => {
  const reader: HelpReader = { audience: 'workspace', features: [...FEATURE_KEYS], level: 'SUPER', permissions: [...PERMISSIONS] };
  const items = { faqs: faqsFor(reader), guides: guidesFor(reader) };

  it('ignores case and accents', () => {
    expect(foldText('Facturación  E-Mail')).toBe('facturacion email');
  });

  it('finds questions before guides and needs every word', () => {
    const hits = searchHelp('forgot password', 'en', items);
    expect(hits[0]).toMatchObject({ kind: 'faq', faq: { id: 'account.password' } });
    expect(searchHelp('password zebra', 'en', items)).toEqual([]);
  });

  it('searches in the reader’s language and still in English', () => {
    expect(searchHelp('contraseña', 'es', items).some((h) => h.kind === 'faq' && h.faq.id === 'account.password')).toBe(true);
    expect(searchHelp('pipeline', 'de', items).length).toBeGreaterThan(0);
    expect(searchHelp('كلمة المرور', 'ar', items).some((h) => h.kind === 'faq' && h.faq.id === 'account.password')).toBe(true);
  });

  it('finds guides by page title', () => {
    expect(searchHelp('sequences', 'en', items).some((h) => h.kind === 'guide' && h.guide.id === 'page.sequences')).toBe(true);
  });

  it('matches half the longer words of a sentence in a partial search', () => {
    const sentence = 'Export deals to Excel for our board';
    expect(searchHelp(sentence, 'en', items)).toEqual([]);
    const hits = searchHelp(sentence, 'en', items, undefined, { partial: true });
    expect(hits.some((h) => h.kind === 'faq' && h.faq.id === 'data.export')).toBe(true);
    expect(searchHelp('zebra giraffe walrus', 'en', items, undefined, { partial: true })).toEqual([]);
  });
});
