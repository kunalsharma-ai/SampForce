'use client';

import {
  categoriesFor,
  faqsFor,
  guidesFor,
  type HelpReader,
  helpText,
  roleGuideFor,
} from '@dealflow/help';
import { Button, Input, Skeleton } from '@dealflow/ui';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Clock3,
  Flame,
  Inbox,
  LifeBuoy,
  Megaphone,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHelp } from '@/components/page-help';
import {
  buildHelpView,
  countHelpView,
  type HelpView,
  isFaq,
  popular,
  recentlyUpdated,
  searchView,
  useHelpContent,
  type ViewCategory,
  type ViewFaq,
  type ViewGuide,
  type ViewHit,
} from '@/lib/help-content';
import { type Translator, useT } from '@/lib/i18n';
import {
  ArticleBody,
  FeedbackBar,
  type HelpItem,
  HelpItemDialog,
  helpItemTitle,
  UpdatedOn,
  VideoLink,
} from './article';
import { HelpSettingsButton, RestrictedFeatures, SupportNote } from './help-extras';
import { ToneIcon } from './help-ui';
import { RaiseQueryDialog } from './raise-query';

/**
 * The Help Center (ADR 0073): one search over every answer and guide, announcements, Popular and Recently updated,
 * topic tiles, the FAQs, the feature guide and "Other: raise a query". It shows only help for what the reader can
 * use: the built-in help by the same rules as GET /help, and the Console's articles as the API filtered them.
 */
export function HelpCenter({
  reader,
  queriesHref,
}: {
  reader: HelpReader | null;
  queriesHref?: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState<string | null>(params.get('category'));
  const [opened, setOpened] = useState<HelpItem | null>(null);
  const [raising, setRaising] = useState(params.get('raise') === '1');
  const [from, setFrom] = useState(params.get('from'));
  const faqsRef = useRef<HTMLElement>(null);
  const audience = reader?.audience;
  const remote = useHelpContent(audience);
  const workspace = audience === 'workspace';

  const view = useMemo(
    () => (reader ? buildHelpView(reader, remote.data, t.language, (s) => t.maybe(s)) : null),
    [reader, remote.data, t],
  );
  // "Raise a query" offers the built-in topics, which the API knows.
  const queryCategories = useMemo(
    () => (reader ? categoriesFor(reader, faqsFor(reader), guidesFor(reader)) : []),
    [reader],
  );

  // Keep the address in step, so a search or topic can be shared and the back button works.
  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (category) next.set('category', category);
    const qs = next.toString();
    // The history API, not the router: a router.replace still waiting would undo a link the person just followed.
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (url !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(window.history.state, '', url);
  }, [query, category, pathname]);

  const hits = useMemo(
    () => (view && query.trim() ? searchView(view, query) : null),
    [view, query],
  );

  // "Open the full guide" from a page's i button lands here with ?guide=<page id>; it opens once the content is in.
  const [guideParam] = useState(params.get('guide'));
  const guideOpened = useRef(false);
  useEffect(() => {
    if (!guideParam || !view || !remote.isFetched || guideOpened.current) return;
    guideOpened.current = true;
    const g = view.guides.find((x) => x.id === guideParam);
    if (g) {
      setOpened(g);
      if (workspace) countHelpView(g.key);
    }
  }, [guideParam, view, remote.isFetched, workspace]);

  const open = (item: HelpItem) => {
    setOpened(item);
    if (workspace) countHelpView(item.key);
  };

  if (!view || remote.isLoading) return <Skeleton className="h-[32rem] rounded-3xl" />;
  const settings = remote.data?.settings;
  const raiseCard = workspace ? (
    <section
      aria-labelledby="help-more"
      className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-r from-accent/15 via-primary/10 to-background p-6 sm:p-8"
      data-raise-query-card
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-accent/25 blur-3xl"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <span
            className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg"
            aria-hidden
          >
            <LifeBuoy className="size-6" />
          </span>
          <div>
            <h2 id="help-more" className="text-lg font-semibold">
              {t('Didn’t find your answer?')}
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {t(
                'Tell the SampForce support team what you need. You get a reference number, a notification when they reply, and the whole conversation in My queries.',
              )}
            </p>
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
  ) : null;
  const raiseDialog =
    workspace && reader ? (
      <RaiseQueryDialog
        open={raising}
        onOpenChange={setRaising}
        reader={reader}
        categories={queryCategories}
        initialQuery={query}
        fromPath={from}
        queriesHref={queriesHref ?? '/app/help/queries'}
        defaultCategory={queryCategories.some((c) => c.id === category) ? category : null}
      />
    ) : null;

  // The Console switched Help off for this client: no answers or guides, but support is still one click away.
  if (workspace && settings && !settings.helpEnabled)
    return (
      <div className="mx-auto max-w-4xl space-y-6" data-help-center="workspace" data-help-off>
        <div className="flex items-center gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">{t('Help & support')}</h1>
          <PageHelp />
        </div>
        <p className="text-muted-foreground">
          {t(
            'Answers and guides are not part of your organisation’s SampForce service. The support team is still here for any question.',
          )}
        </p>
        <SupportNote note={settings.supportNote} />
        {raiseCard}
        {raiseDialog}
      </div>
    );
  const inTopic = (id: string, topic: string) =>
    id === topic || view.categories.some((c) => c.id === id && c.parentId === topic);
  const counts = new Map(
    view.categories.map((c) => [
      c.id,
      view.faqs.filter((q) => inTopic(q.category, c.id)).length +
        view.guides.filter((g) => inTopic(g.category, c.id)).length,
    ]),
  );
  const topLevel = view.categories.filter(
    (c) => !c.parentId || !view.categories.some((p) => p.id === c.parentId),
  );
  const shownCategories = category
    ? view.categories.filter((c) => c.id === category || c.parentId === category)
    : view.categories;
  const byId = new Map(view.categories.map((c) => [c.id, c]));
  const related = opened ? relatedTo(view, opened) : [];
  const pickTopic = (id: string | null) => {
    setQuery('');
    setCategory(id);
    faqsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10" data-help-center={audience}>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-accent/10 to-background px-6 py-10 sm:px-10 sm:py-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 start-1/3 size-72 rounded-full bg-accent/20 blur-3xl"
        />
        {workspace && settings?.canManage && (
          <div className="absolute end-4 top-4 z-10">
            <HelpSettingsButton settings={settings} />
          </div>
        )}
        <div className="relative mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-background/60 px-3 py-1 text-xs font-medium text-primary backdrop-blur">
            <Sparkles className="size-3.5" aria-hidden />
            {workspace ? t('Answers for your workspace') : t('Answers for the Console')}
          </span>
          <div className="mt-4 flex items-center justify-center gap-1.5">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('How can we help?')}
            </h1>
            <PageHelp />
          </div>
          <p className="mt-3 text-muted-foreground">
            {t('{faqs} answers and {guides} feature guides, only for what you can use.', {
              faqs: view.faqs.length,
              guides: view.guides.length,
            })}
          </p>
          <div className="relative mx-auto mt-6 max-w-2xl">
            <Search
              className="pointer-events-none absolute start-4 z-10 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
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
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
                aria-label={t('Clear search')}
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {topLevel.slice(0, 6).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickTopic(c.id)}
                className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-foreground backdrop-blur hover:border-primary/50 hover:text-primary"
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Announcements ── */}
      {view.announcements.length > 0 && !hits && (
        <section aria-label={t('Announcements')} className="space-y-3" data-help-announcements>
          {view.announcements.map((a) => (
            <details
              key={a.key}
              className="group rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 to-transparent p-4"
              data-help-announcement={a.key}
            >
              <summary className="flex cursor-pointer list-none items-start gap-3 marker:hidden [&::-webkit-details-marker]:hidden">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"
                  aria-hidden
                >
                  <Megaphone className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{a.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{a.summary}</span>
                </span>
                <UpdatedOn iso={a.updatedAt} />
              </summary>
              {(a.body || a.videoUrl) && (
                <div className="mt-3 space-y-3 ps-12">
                  <ArticleBody body={a.body} audience={audience!} />
                  <VideoLink url={a.videoUrl} />
                </div>
              )}
            </details>
          ))}
        </section>
      )}

      {hits ? (
        <SearchResults
          hits={hits}
          query={query}
          t={t}
          view={view}
          byId={byId}
          onOpen={open}
          audience={audience!}
          onRaise={workspace ? () => setRaising(true) : undefined}
        />
      ) : (
        <>
          {/* ── Popular and recently updated ── */}
          {!category && (
            <Highlights
              view={view}
              builtinUpdatedAt={remote.data?.builtinUpdatedAt}
              onOpen={open}
              t={t}
            />
          )}

          {/* ── Start here, for the reader's role ── */}
          {!category && reader && <RoleStart reader={reader} view={view} onOpen={open} t={t} />}

          {/* ── Topics ── */}
          <section aria-labelledby="help-topics">
            <SectionTitle
              id="help-topics"
              icon={<BookOpen className="size-5" aria-hidden />}
              title={t('Browse by topic')}
            />
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topLevel.map((c) => {
                const subs = view.categories.filter((s) => s.parentId === c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickTopic(category === c.id ? null : c.id)}
                      aria-pressed={category === c.id}
                      data-help-category={c.id}
                      className="group flex h-full w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-start transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary/30"
                    >
                      <ToneIcon icon={c.icon} tone={c.tone} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{c.title}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {counts.get(c.id)}
                          </span>
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {c.description}
                        </span>
                        {subs.length > 0 && (
                          <span className="mt-2 block text-xs text-muted-foreground">
                            {subs.map((s) => s.title).join(' · ')}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
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
                const faqs = view.faqs.filter((q) => q.category === c.id);
                if (!faqs.length) return null;
                return (
                  <div key={c.id} data-faq-group={c.id}>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                      <ToneIcon icon={c.icon} tone={c.tone} size="sm" />
                      {topicName(c, byId)}
                    </h3>
                    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                      {faqs.map((q) => (
                        <FaqItem
                          key={q.key}
                          faq={q}
                          t={t}
                          onOpen={open}
                          audience={audience!}
                          mine={view.myFeedback[q.key]}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Feature guide ── */}
          <section id="guide" aria-labelledby="help-guide" className="scroll-mt-20">
            <SectionTitle
              id="help-guide"
              icon={<BookOpen className="size-5" aria-hidden />}
              title={t('Feature guide')}
            />
            <p className="-mt-2 mb-4 text-sm text-muted-foreground">
              {t(
                'What every page and section is for, how to use it and when it helps. The same help opens from the i button next to each title.',
              )}
            </p>
            <div className="space-y-6">
              {shownCategories.map((c) => {
                const guides = view.guides.filter((g) => g.category === c.id);
                if (!guides.length) return null;
                return (
                  <div key={c.id}>
                    <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                      {topicName(c, byId)}
                    </h3>
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {guides.map((g) => (
                        <li key={g.key}>
                          <GuideCard guide={g} category={c} t={t} onOpen={() => open(g)} />
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

      {workspace && settings?.explainRestricted && !hits && reader && (
        <RestrictedFeatures reader={reader} />
      )}
      {workspace && <SupportNote note={settings?.supportNote ?? null} />}
      {raiseCard}

      <HelpItemDialog
        item={opened}
        onClose={() => setOpened(null)}
        onOpen={open}
        related={related}
        audience={audience!}
        myFeedback={view.myFeedback}
        onRaise={
          workspace
            ? (path) => {
                setOpened(null);
                if (path) setFrom(path);
                setRaising(true);
              }
            : undefined
        }
      />
      {raiseDialog}
    </div>
  );
}

/** The pages to learn first for the reader's role, in order, as far as their plan and role include them. */
function RoleStart({
  reader,
  view,
  onOpen,
  t,
}: {
  reader: HelpReader;
  view: HelpView;
  onOpen: (i: HelpItem) => void;
  t: Translator;
}) {
  const role = roleGuideFor(reader);
  const guides = role.pages.flatMap((id) => view.guides.filter((g) => g.builtin?.id === id));
  if (!guides.length) return null;
  return (
    <section
      aria-labelledby="help-role"
      className="rounded-3xl border border-border bg-card p-6"
      data-help-role={role.role}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="help-role" className="text-xl font-semibold tracking-tight">
          {t('Start here: {role}', { role: helpText(role.title, t.language) })}
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{helpText(role.intro, t.language)}</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {guides.map((g, i) => (
          <li key={g.key}>
            <button
              type="button"
              onClick={() => onOpen(g)}
              className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-start text-sm hover:border-primary/40"
              data-help-role-step={g.id}
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="font-medium">{g.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A subtopic reads "Topic › Subtopic", so its group is clear on its own. */
function topicName(c: ViewCategory, byId: Map<string, ViewCategory>): string {
  const parent = c.parentId ? byId.get(c.parentId) : undefined;
  return parent ? `${parent.title} › ${c.title}` : c.title;
}

/** Other answers and guides on the same topic, the guide an answer points to first. */
function relatedTo(view: HelpView, item: HelpItem): HelpItem[] {
  const out: HelpItem[] = [];
  if (isFaq(item) && item.guide) {
    const g = view.guides.find((x) => x.builtin?.id === item.guide!.id);
    if (g) out.push(g);
  }
  for (const x of [...view.guides, ...view.faqs]) {
    if (out.length >= 4) break;
    if (x.key !== item.key && x.category === item.category && !out.includes(x)) out.push(x);
  }
  return out;
}

function Highlights({
  view,
  builtinUpdatedAt,
  onOpen,
  t,
}: {
  view: HelpView;
  builtinUpdatedAt: string | undefined;
  onOpen: (i: HelpItem) => void;
  t: Translator;
}) {
  const top = popular(view);
  const recent = recentlyUpdated(view, builtinUpdatedAt);
  if (!top.length && !recent.length) return null;
  const list = (items: HelpItem[], attr: string, date: boolean) => (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {items.map((i) => (
        <li key={i.key}>
          <button
            type="button"
            onClick={() => onOpen(i)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start text-sm hover:bg-muted/40"
            {...{ [attr]: i.id }}
          >
            <span className="font-medium">{helpItemTitle(i)}</span>
            {date ? (
              <UpdatedOn iso={i.updatedAt} />
            ) : (
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                aria-hidden
              />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {top.length > 0 && (
        <section aria-labelledby="help-popular" data-help-popular>
          <SectionTitle
            id="help-popular"
            icon={<Flame className="size-5" aria-hidden />}
            title={t('Popular articles')}
          />
          {list(top, 'data-help-popular-item', false)}
        </section>
      )}
      {recent.length > 0 && (
        <section aria-labelledby="help-recent" data-help-recent>
          <SectionTitle
            id="help-recent"
            icon={<Clock3 className="size-5" aria-hidden />}
            title={t('Recently updated guides')}
          />
          {list(recent, 'data-help-recent-item', true)}
        </section>
      )}
    </div>
  );
}

function SectionTitle({
  id,
  icon,
  title,
  action,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
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

function FaqItem({
  faq,
  t,
  onOpen,
  audience,
  mine,
  open,
}: {
  faq: ViewFaq;
  t: Translator;
  onOpen: (i: HelpItem) => void;
  audience: 'workspace' | 'console';
  mine: boolean | undefined;
  open?: boolean;
}) {
  return (
    <details
      className="group px-4 py-1 open:bg-muted/30"
      data-faq={faq.id}
      open={open}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && audience === 'workspace')
          countHelpView(faq.key);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium marker:hidden [&::-webkit-details-marker]:hidden">
        <span>{faq.q}</span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="space-y-3 pb-4 text-sm leading-relaxed text-muted-foreground">
        <p>{faq.a}</p>
        {faq.body && (
          <div className="text-foreground">
            <ArticleBody body={faq.body} audience={audience} />
          </div>
        )}
        <VideoLink url={faq.videoUrl} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {faq.guide ? (
            <button
              type="button"
              onClick={() => onOpen(guideItem(faq))}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('Read the guide: {title}', { title: t.maybe(faq.guide.topic.title) })}
            </button>
          ) : (
            <span />
          )}
          <UpdatedOn iso={faq.updatedAt} />
        </div>
        {audience === 'workspace' && <FeedbackBar articleKey={faq.key} mine={mine} />}
      </div>
    </details>
  );
}

/** The guide an answer points to, opened in the dialog: a light copy is enough, the dialog reads its built-in page. */
function guideItem(faq: ViewFaq): ViewGuide {
  const g = faq.guide!;
  return {
    key: `guide:${g.id}`,
    id: g.id,
    category: g.category,
    title: g.topic.title,
    what: '',
    body: '',
    videoUrl: null,
    builtin: g,
    updatedAt: faq.updatedAt,
    english: '',
  };
}

function GuideCard({
  guide,
  category,
  t,
  onOpen,
}: {
  guide: ViewGuide;
  category: ViewCategory;
  t: Translator;
  onOpen: () => void;
}) {
  const sections = guide.builtin?.sections.length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-help-guide={guide.id}
      className="group flex h-full w-full flex-col rounded-2xl border border-border bg-card p-4 text-start transition hover:border-primary/40 hover:shadow-md motion-reduce:transition-none"
    >
      <span className="flex items-center gap-2">
        <ToneIcon icon={category.icon} tone={category.tone} size="sm" />
        <span className="font-semibold">{guide.title}</span>
      </span>
      <span className="mt-2 line-clamp-3 text-sm text-muted-foreground">{guide.what}</span>
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-primary">
        {sections > 0 ? t('Guide and {count} sections', { count: sections }) : t('Read the guide')}
        <ArrowRight
          className="size-3.5 transition group-hover:translate-x-0.5 rtl:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </span>
    </button>
  );
}

/** Results while typing, grouped by module (topic); with nothing found, the most read help and the raise-query way out. */
function SearchResults({
  hits,
  query,
  t,
  view,
  byId,
  onOpen,
  audience,
  onRaise,
}: {
  hits: ViewHit[];
  query: string;
  t: Translator;
  view: HelpView;
  byId: Map<string, ViewCategory>;
  onOpen: (i: HelpItem) => void;
  audience: 'workspace' | 'console';
  onRaise?: () => void;
}) {
  const groups = new Map<string, ViewHit[]>();
  for (const h of hits) groups.set(h.item.category, [...(groups.get(h.item.category) ?? []), h]);
  const suggestions = popular(view, 4).length ? popular(view, 4) : view.guides.slice(0, 4);
  return (
    <section aria-labelledby="help-results" data-help-results>
      <p className="sr-only" aria-live="polite">
        {t('{count} results for “{query}”', { count: hits.length, query })}
      </p>
      <SectionTitle
        id="help-results"
        icon={<Search className="size-5" aria-hidden />}
        title={t('Results for “{query}”', { query: query.trim() })}
      />
      {hits.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-border p-8 text-center"
          data-help-no-results
        >
          <p className="font-medium">
            {t('Nothing matches “{query}” yet.', { query: query.trim() })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Try fewer or different words, or ask the support team.')}
          </p>
          {suggestions.length > 0 && (
            <div className="mx-auto mt-5 max-w-xl text-start">
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                {t('These guides may help')}
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => onOpen(s)}
                      className="w-full rounded-xl border border-border bg-card p-3 text-start text-sm font-medium hover:border-primary/40"
                      data-help-suggestion={s.id}
                    >
                      {helpItemTitle(s)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {onRaise && (
            <Button className="mt-5" onClick={onRaise}>
              {t('Other: raise a query')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups].map(([id, list]) => {
            const c = byId.get(id);
            const faqs = list.flatMap((h) => (h.kind === 'faq' ? [h.item] : []));
            const guides = list.flatMap((h) => (h.kind === 'guide' ? [h.item] : []));
            return (
              <div key={id} data-help-result-group={id}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  {c && <ToneIcon icon={c.icon} tone={c.tone} size="sm" />}
                  {c ? topicName(c, byId) : id}
                </h3>
                <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
                  {faqs.length > 0 ? (
                    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                      {faqs.map((f, i) => (
                        <FaqItem
                          key={f.key}
                          faq={f}
                          t={t}
                          onOpen={onOpen}
                          audience={audience}
                          mine={view.myFeedback[f.key]}
                          open={i === 0 && hits[0]?.item === f}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="hidden lg:block" />
                  )}
                  <ul className="space-y-2">
                    {guides.map((g) => (
                      <li key={g.key}>
                        <button
                          type="button"
                          onClick={() => onOpen(g)}
                          data-help-guide={g.id}
                          className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-start hover:border-primary/40"
                        >
                          <span className="min-w-0">
                            <span className="block font-medium">{g.title}</span>
                            <span className="line-clamp-2 text-sm text-muted-foreground">
                              {g.what}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
