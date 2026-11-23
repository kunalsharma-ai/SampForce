'use client';

import {
  categoriesFor,
  faqsFor,
  type HelpCategory,
  type HelpFaq,
  type HelpGuide,
  type HelpReader,
  guidesFor,
  helpText,
  searchHelp,
} from '@dealflow/help';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { ArrowRight, BookOpen, ChevronDown, CircleHelp, Inbox, LifeBuoy, Search, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHelp } from '@/components/page-help';
import { type Translator, useT } from '@/lib/i18n';
import { ToneIcon } from './help-ui';
import { RaiseQueryDialog } from './raise-query';

/**
 * The Help Center (ADR 0073): one search over every answer and guide, topic tiles, the FAQs, the feature guide and
 * "Other: raise a query". It shows only help for what the reader can use: the same rules as GET /help.
 */
export function HelpCenter({ reader, queriesHref }: { reader: HelpReader | null; queriesHref?: string }) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState<string | null>(params.get('category'));
  const [openGuide, setOpenGuide] = useState<HelpGuide | null>(null);
  const [raising, setRaising] = useState(params.get('raise') === '1');
  const [from] = useState(params.get('from'));
  const faqsRef = useRef<HTMLElement>(null);

  const content = useMemo(() => {
    if (!reader) return null;
    const faqs = faqsFor(reader);
    const guides = guidesFor(reader);
    return { faqs, guides, categories: categoriesFor(reader, faqs, guides) };
  }, [reader]);

  // Keep the address in step, so a search or topic can be shared and the back button works.
  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (category) next.set('category', category);
    const qs = next.toString();
    // The history API, not the router: a router.replace still waiting would undo a link the person just followed.
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
  }, [query, category, pathname]);

  const titleOf = (english: string) => t.maybe(english);
  const hits = useMemo(
    () => (content && query.trim() ? searchHelp(query, t.language, content, (s) => t.maybe(s)) : null),
    [content, query, t],
  );

  if (!content) return <Skeleton className="h-[32rem] rounded-3xl" />;
  const counts = new Map(content.categories.map((c) => [c.id, content.faqs.filter((q) => q.category === c.id).length + content.guides.filter((g) => g.category === c.id).length]));
  const shownCategories = category ? content.categories.filter((c) => c.id === category) : content.categories;
  const workspace = reader?.audience === 'workspace';

  return (
    <div className="mx-auto max-w-6xl space-y-10" data-help-center={reader?.audience}>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-accent/10 to-background px-6 py-10 sm:px-10 sm:py-14">
        <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 start-1/3 size-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-background/60 px-3 py-1 text-xs font-medium text-primary backdrop-blur">
            <Sparkles className="size-3.5" aria-hidden />
            {workspace ? t('Answers for your workspace') : t('Answers for the Console')}
          </span>
          <div className="mt-4 flex items-center justify-center gap-1.5">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('How can we help?')}</h1>
            <PageHelp />
          </div>
          <p className="mt-3 text-muted-foreground">
            {t('{faqs} answers and {guides} feature guides, only for what you can use.', { faqs: content.faqs.length, guides: content.guides.length })}
          </p>
          <div className="relative mx-auto mt-6 max-w-2xl">
            <Search className="pointer-events-none absolute start-4 z-10 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search questions and guides, for example “import”')}
              aria-label={t('Search help')}
              className="h-14 rounded-2xl border-border/80 bg-background/90 ps-12 pe-12 text-base shadow-lg backdrop-blur"
              data-help-search
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label={t('Clear search')}>
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {content.categories.slice(0, 6).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory(c.id);
                  faqsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-foreground backdrop-blur hover:border-primary/50 hover:text-primary"
              >
                {helpText(c.title, t.language)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {hits ? (
        <SearchResults hits={hits} query={query} t={t} titleOf={titleOf} onGuide={setOpenGuide} categories={content.categories} onRaise={workspace ? () => setRaising(true) : undefined} />
      ) : (
        <>
          {/* ── Topics ── */}
          <section aria-labelledby="help-topics">
            <SectionTitle id="help-topics" icon={<BookOpen className="size-5" aria-hidden />} title={t('Browse by topic')} />
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {content.categories.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCategory(category === c.id ? null : c.id);
                      faqsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    aria-pressed={category === c.id}
                    data-help-category={c.id}
                    className="group flex h-full w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-start transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary/30"
                  >
                    <ToneIcon icon={c.icon} tone={c.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{helpText(c.title, t.language)}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{counts.get(c.id)}</span>
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">{helpText(c.description, t.language)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* ── FAQs ── */}
          <section ref={faqsRef} aria-labelledby="help-faqs" className="scroll-mt-20" id="faqs">
            <SectionTitle
              id="help-faqs"
              icon={<CircleHelp className="size-5" aria-hidden />}
              title={t('Frequently asked questions')}
              action={
                category ? (
                  <Button variant="ghost" size="sm" onClick={() => setCategory(null)}>
                    {t('Show all topics')}
                  </Button>
                ) : null
              }
            />
            <div className="space-y-6">
              {shownCategories.map((c) => {
                const faqs = content.faqs.filter((q) => q.category === c.id);
                if (!faqs.length) return null;
                return (
                  <div key={c.id} data-faq-group={c.id}>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                      <ToneIcon icon={c.icon} tone={c.tone} size="sm" />
                      {helpText(c.title, t.language)}
                    </h3>
                    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                      {faqs.map((q) => (
                        <FaqItem key={q.id} faq={q} t={t} guides={content.guides} onGuide={setOpenGuide} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Feature guide ── */}
          <section id="guide" aria-labelledby="help-guide" className="scroll-mt-20">
            <SectionTitle id="help-guide" icon={<BookOpen className="size-5" aria-hidden />} title={t('Feature guide')} />
            <p className="-mt-2 mb-4 text-sm text-muted-foreground">{t('What every page and section is for, how to use it and when it helps. The same help opens from the i button next to each title.')}</p>
            <div className="space-y-6">
              {shownCategories.map((c) => {
                const guides = content.guides.filter((g) => g.category === c.id);
                if (!guides.length) return null;
                return (
                  <div key={c.id}>
                    <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{helpText(c.title, t.language)}</h3>
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {guides.map((g) => (
                        <li key={g.id}>
                          <GuideCard guide={g} category={c} t={t} onOpen={() => setOpenGuide(g)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* ── Still need help ── */}
      {workspace && (
        <section aria-labelledby="help-more" className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-r from-accent/15 via-primary/10 to-background p-6 sm:p-8" data-raise-query-card>
          <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-accent/25 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg" aria-hidden>
                <LifeBuoy className="size-6" />
              </span>
              <div>
                <h2 id="help-more" className="text-lg font-semibold">
                  {t('Didn’t find your answer?')}
                </h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('Tell the SampForce support team what you need. You get a reference number, a notification when they reply, and the whole conversation in My queries.')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {queriesHref && (
                <Button asChild variant="outline">
                  <Link href={queriesHref}>
                    <Inbox aria-hidden /> {t('My queries')}
                  </Link>
                </Button>
              )}
              <Button onClick={() => setRaising(true)} data-raise-query>
                {t('Other: raise a query')} <ArrowRight className="rtl:rotate-180" aria-hidden />
              </Button>
            </div>
          </div>
        </section>
      )}

      <GuideDialog guide={openGuide} onClose={() => setOpenGuide(null)} t={t} />
      {workspace && reader && (
        <RaiseQueryDialog
          open={raising}
          onOpenChange={setRaising}
          reader={reader}
          categories={content.categories}
          initialQuery={query}
          fromPath={from}
          queriesHref={queriesHref ?? '/app/help/queries'}
          defaultCategory={category}
        />
      )}
    </div>
  );
}

function SectionTitle({ id, icon, title, action }: { id: string; icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 id={id} className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      {action}
    </div>
  );
}

function FaqItem({ faq, t, guides, onGuide, open }: { faq: HelpFaq; t: Translator; guides: readonly HelpGuide[]; onGuide: (g: HelpGuide) => void; open?: boolean }) {
  const guide = faq.guide ? guides.find((g) => g.id === faq.guide) : undefined;
  return (
    <details className="group px-4 py-1 open:bg-muted/30" data-faq={faq.id} open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium marker:hidden [&::-webkit-details-marker]:hidden">
        <span>{helpText(faq.q, t.language)}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="pb-4 text-sm leading-relaxed text-muted-foreground">
        <p>{helpText(faq.a, t.language)}</p>
        {guide && (
          <button type="button" onClick={() => onGuide(guide)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
            {t('Read the guide: {title}', { title: t.maybe(guide.topic.title) })}
          </button>
        )}
      </div>
    </details>
  );
}

function GuideCard({ guide, category, t, onOpen }: { guide: HelpGuide; category: HelpCategory; t: Translator; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-help-guide={guide.id}
      className="group flex h-full w-full flex-col rounded-2xl border border-border bg-card p-4 text-start transition hover:border-primary/40 hover:shadow-md motion-reduce:transition-none"
    >
      <span className="flex items-center gap-2">
        <ToneIcon icon={category.icon} tone={category.tone} size="sm" />
        <span className="font-semibold">{t.maybe(guide.topic.title)}</span>
      </span>
      <span className="mt-2 line-clamp-3 text-sm text-muted-foreground">{helpText(guide.topic.what, t.language)}</span>
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-primary">
        {guide.sections.length > 0 ? t('Guide and {count} sections', { count: guide.sections.length }) : t('Read the guide')}
        <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5 rtl:rotate-180 motion-reduce:transition-none" aria-hidden />
      </span>
    </button>
  );
}

function SearchResults({
  hits,
  query,
  t,
  titleOf,
  onGuide,
  categories,
  onRaise,
}: {
  hits: ReturnType<typeof searchHelp>;
  query: string;
  t: Translator;
  titleOf: (s: string) => string;
  onGuide: (g: HelpGuide) => void;
  categories: readonly HelpCategory[];
  onRaise?: () => void;
}) {
  const faqs = hits.filter((h) => h.kind === 'faq');
  const guides = hits.filter((h) => h.kind === 'guide');
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (
    <section aria-labelledby="help-results" data-help-results>
      <p className="sr-only" aria-live="polite">
        {t('{count} results for “{query}”', { count: hits.length, query })}
      </p>
      <SectionTitle id="help-results" icon={<Search className="size-5" aria-hidden />} title={t('Results for “{query}”', { query: query.trim() })} />
      {hits.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center" data-help-no-results>
          <p className="font-medium">{t('Nothing matches “{query}” yet.', { query: query.trim() })}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('Try fewer or different words, or ask the support team.')}</p>
          {onRaise && (
            <Button className="mt-4" onClick={onRaise}>
              {t('Other: raise a query')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('Answers')}</h3>
            {faqs.length ? (
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {faqs.map((h, i) => (h.kind === 'faq' ? <FaqItem key={h.faq.id} faq={h.faq} t={t} guides={guides.flatMap((g) => (g.kind === 'guide' ? [g.guide] : []))} onGuide={onGuide} open={i === 0} /> : null))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('No question matches, but these guides do.')}</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('Feature guides')}</h3>
            <ul className="space-y-2">
              {guides.map((h) =>
                h.kind === 'guide' ? (
                  <li key={h.guide.id}>
                    <button
                      type="button"
                      onClick={() => onGuide(h.guide)}
                      data-help-guide={h.guide.id}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-start hover:border-primary/40"
                    >
                      {byId.get(h.guide.category) && <ToneIcon icon={byId.get(h.guide.category)!.icon} tone={byId.get(h.guide.category)!.tone} size="sm" />}
                      <span className="min-w-0">
                        <span className="block font-medium">{titleOf(h.guide.topic.title)}</span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">{helpText(h.guide.topic.what, t.language)}</span>
                      </span>
                    </button>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function GuideDialog({ guide, onClose, t }: { guide: HelpGuide | null; onClose: () => void; t: Translator }) {
  return (
    <Dialog open={!!guide} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[8%] max-h-[84vh] max-w-2xl overflow-y-auto p-0">
        {guide && (
          <div data-help-guide-dialog={guide.id}>
            <div className="border-b border-border bg-gradient-to-br from-primary/15 to-transparent px-6 pb-5 pt-6">
              <Badge tone="primary">{t('Feature guide')}</Badge>
              <DialogTitle className="mt-2 text-xl font-semibold">{t.maybe(guide.topic.title)}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">{helpText(guide.topic.what, t.language)}</DialogDescription>
            </div>
            <div className="space-y-5 px-6 py-5">
              <Explanation guide={guide} t={t} />
              {guide.sections.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t('Sections on this page')}</h3>
                  <ul className="space-y-3">
                    {guide.sections.map((s) => (
                      <li key={s.id} className="rounded-xl border border-border bg-muted/30 p-3">
                        <h4 className="text-sm font-medium">{t.maybe(s.topic.title)}</h4>
                        <p className="mt-1 text-sm text-muted-foreground">{helpText(s.topic.what, t.language)}</p>
                        <p className="mt-1 text-sm">{helpText(s.topic.how, t.language)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {guide.href && (
                <Button asChild>
                  <Link href={guide.href}>
                    {t('Open page')} <ArrowRight className="rtl:rotate-180" aria-hidden />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Explanation({ guide, t }: { guide: HelpGuide; t: Translator }) {
  const rows: [string, string][] = [
    [t('How to use it'), helpText(guide.topic.how, t.language)],
    [t('Where to use it'), helpText(guide.topic.where, t.language)],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, text]) => (
        <div key={label} className="rounded-xl border border-border p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</dt>
          <dd className="mt-1 text-sm">{text}</dd>
        </div>
      ))}
    </dl>
  );
}
