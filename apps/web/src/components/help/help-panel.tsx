'use client';

import type { HelpReader } from '@dealflow/help';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Compass,
  Inbox,
  Keyboard,
  LifeBuoy,
  PenSquare,
  Search,
  Ticket,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  buildHelpView,
  countHelpView,
  popular,
  searchBriefs,
  searchView,
  useHelpContent,
  type ViewFaq,
} from '@/lib/help-content';
import { useT } from '@/lib/i18n';
import { ToneIcon } from './help-ui';

type Audience = 'workspace' | 'console';

/**
 * The Help & Support button in the top bar of every workspace and of the Console (ADR 0073). It opens a panel that
 * answers as you type (answers open in place, guides and features in the Help Center) and leads to the Help Center,
 * Explore SampForce, "Other: raise a query" and My queries. In the Console it leads to Help, its management and the
 * support tickets instead.
 */
export function HelpSupportButton({
  reader,
  onShortcuts,
  canManage = false,
}: {
  reader: HelpReader | null;
  onShortcuts?: () => void;
  /** Console: whether this operator may edit Help content. */
  canManage?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const audience: Audience = reader?.audience ?? 'workspace';
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t('Help & support')}
        aria-haspopup="dialog"
        className="gap-1.5 border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10 [&_svg]:text-primary"
        data-help-menu
        data-help-support-button={audience}
      >
        <LifeBuoy aria-hidden />
        <span className="hidden lg:inline">{t('Help & support')}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent side="right" className="flex max-w-md flex-col p-0" data-help-panel={audience}>
          {open && reader && (
            <Panel
              reader={reader}
              audience={audience}
              onClose={() => setOpen(false)}
              onShortcuts={
                onShortcuts
                  ? () => {
                      setOpen(false);
                      onShortcuts();
                    }
                  : undefined
              }
              canManage={canManage}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Panel({
  reader,
  audience,
  onClose,
  onShortcuts,
  canManage,
}: {
  reader: HelpReader;
  audience: Audience;
  onClose: () => void;
  onShortcuts?: () => void;
  canManage: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const remote = useHelpContent(audience);
  const view = useMemo(
    () => buildHelpView(reader, remote.data, t.language, (s) => t.maybe(s)),
    [reader, remote.data, t],
  );
  const workspace = audience === 'workspace';
  const base = workspace ? '/app/help' : '/operator/help';
  const helpOn = !workspace || remote.data?.settings.helpEnabled !== false;
  const from =
    workspace && pathname && pathname.startsWith('/app') && !pathname.startsWith('/app/help')
      ? `&from=${encodeURIComponent(pathname)}`
      : '';
  const q = query.trim();
  const hits = q && helpOn ? searchView(view, q) : [];
  const briefs = q && helpOn ? searchBriefs(view, q).slice(0, 3) : [];
  const faqs = hits.flatMap((h) => (h.kind === 'faq' ? [h.item] : [])).slice(0, 5);
  const guides = hits.flatMap((h) => (h.kind === 'guide' ? [h.item] : [])).slice(0, 4);
  const top = popular(view, 5).filter((x): x is ViewFaq => 'q' in x);
  // The most read answers first, topped up with the first questions so there are always five to start from.
  const starters = [...top, ...view.faqs.filter((f) => !top.includes(f))].slice(0, 5);

  const actions = [
    { href: base, icon: <BookOpen className="size-4" aria-hidden />, label: t('Help center'), show: helpOn, attr: 'center' },
    { href: `${base}#explore`, icon: <Compass className="size-4" aria-hidden />, label: t('Explore SampForce'), show: helpOn && view.briefs.length > 0, attr: 'explore' },
    { href: `${base}#faqs`, icon: <CircleHelp className="size-4" aria-hidden />, label: t('Frequently asked questions'), show: helpOn, attr: 'faqs' },
    { href: `${base}#guide`, icon: <BookOpen className="size-4" aria-hidden />, label: t('Feature guide'), show: helpOn, attr: 'guide' },
    { href: '/app/help/queries', icon: <Inbox className="size-4" aria-hidden />, label: t('My queries'), show: workspace, attr: 'queries' },
    { href: '/operator/support', icon: <Ticket className="size-4" aria-hidden />, label: t('Support tickets'), show: !workspace, attr: 'tickets' },
    { href: '/operator/help/manage', icon: <PenSquare className="size-4" aria-hidden />, label: t('Manage Help content'), show: !workspace && canManage, attr: 'manage' },
  ].filter((a) => a.show);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/20 via-accent/10 to-transparent px-5 pb-5 pt-6">
        <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-primary/25 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-0.5 text-[11px] font-semibold text-primary backdrop-blur">
            <LifeBuoy className="size-3.5" aria-hidden /> {t('Help & support')}
          </span>
          <DialogTitle className="mt-3 text-xl font-semibold tracking-tight">{t('How can we help?')}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {helpOn ? t('Ask anything about SampForce. Answers appear as you type.') : t('Our support team is here for any question.')}
          </DialogDescription>
          {helpOn && (
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute start-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search help')}
                aria-label={t('Search help')}
                className="h-11 rounded-xl bg-background/90 ps-9 pe-9 shadow-md"
                data-help-panel-search
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
                  aria-label={t('Clear search')}
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {q ? (
          <div className="space-y-4" data-help-panel-results>
            <p className="sr-only" aria-live="polite">
              {t('{count} results for “{query}”', { count: faqs.length + guides.length + briefs.length, query: q })}
            </p>
            {briefs.length > 0 && (
              <ul className="space-y-2">
                {briefs.map((b) => (
                  <li key={b.key}>
                    <Link
                      href={`${base}?q=${encodeURIComponent(q)}`}
                      onClick={onClose}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 hover:border-primary/40"
                      data-help-panel-brief={b.id}
                    >
                      <ToneIcon icon={b.icon} tone={b.tone} size="sm" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{b.title}</span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">{b.summary}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {faqs.length > 0 && (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {faqs.map((f, i) => (
                  <PanelFaq key={f.key} faq={f} open={i === 0} workspace={workspace} />
                ))}
              </div>
            )}
            {guides.length > 0 && (
              <ul className="space-y-1">
                {guides.map((g) => (
                  <li key={g.key}>
                    <Link
                      href={`${base}?guide=${encodeURIComponent(g.id)}`}
                      onClick={onClose}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-muted"
                      data-help-panel-guide={g.id}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <BookOpen className="size-4 shrink-0 text-primary" aria-hidden />
                        <span className="truncate">{g.title}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!faqs.length && !guides.length && !briefs.length && (
              <div className="rounded-xl border border-dashed border-border p-5 text-center" data-help-panel-empty>
                <p className="text-sm font-medium">{t('Nothing matches “{query}” yet.', { query: q })}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('Try fewer or different words, or ask the support team.')}</p>
              </div>
            )}
            <Link
              href={`${base}?q=${encodeURIComponent(q)}`}
              onClick={onClose}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {t('See all results in the Help Center')} <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
          </div>
        ) : (
          <>
            <nav aria-label={t('Help sections')} className="grid grid-cols-2 gap-2" data-help-panel-actions>
              {actions.map((a) => (
                <Link
                  key={a.attr}
                  href={a.href}
                  onClick={onClose}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition hover:border-primary/40 hover:bg-primary/5"
                  data-help-panel-action={a.attr}
                >
                  <span className="text-primary">{a.icon}</span>
                  <span className="leading-tight">{a.label}</span>
                </Link>
              ))}
              {onShortcuts && (
                <button
                  type="button"
                  onClick={onShortcuts}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-start text-sm font-medium transition hover:border-primary/40 hover:bg-primary/5"
                  data-help-panel-action="shortcuts"
                >
                  <Keyboard className="size-4 text-primary" aria-hidden />
                  <span className="leading-tight">{t('top.shortcuts')}</span>
                </button>
              )}
            </nav>
            {helpOn && starters.length > 0 && (
              <section aria-labelledby="help-panel-popular">
                <h3 id="help-panel-popular" className="mb-2 text-sm font-semibold text-muted-foreground">
                  {t('Popular articles')}
                </h3>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {starters.map((f) => (
                    <PanelFaq key={f.key} faq={f} workspace={workspace} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {workspace && (
        <div className="border-t border-border bg-muted/30 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t('Didn’t find your answer?')}</p>
              <p className="text-xs text-muted-foreground">{t('Raise a query, we reply here')}</p>
            </div>
            <Button asChild size="sm">
              <Link href={`/app/help?raise=1${from}`} onClick={onClose} data-menu-raise-query>
                {t('Other: raise a query')}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelFaq({ faq, open, workspace }: { faq: ViewFaq; open?: boolean; workspace: boolean }) {
  return (
    <details
      className="group px-3 open:bg-muted/30"
      open={open}
      data-help-panel-faq={faq.id}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && workspace) countHelpView(faq.key);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2.5 text-sm font-medium marker:hidden [&::-webkit-details-marker]:hidden">
        <span>{faq.q}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <p className="pb-3 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
    </details>
  );
}
