'use client';

import { Badge, Card, CardContent } from '@dealflow/ui';
import { BID_TEMPLATES, type BidTemplate } from '@dealflow/types';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AccentPicker } from '@/components/bids/accent-picker';
import { EXAMPLE_LINES, previewProposal, ProposalPreview, TemplateThumb } from '@/components/bids/bid-preview';
import { useCommercialSettings } from '@/lib/revenue';
import { useCan, useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';

const CATEGORIES = ['All', ...Array.from(new Set(BID_TEMPLATES.map((t) => t.category)))];

/** Template gallery: browse the ten bid looks, preview one with example content, tune the accent and start a bid. */
export function TemplateGallery() {
  const t = useT();
  const { data: session } = useSession();
  const settings = useCommercialSettings();
  const canWrite = useCan('quotes:write');
  const [category, setCategory] = useState('All');
  const [selected, setSelected] = useState<BidTemplate>(BID_TEMPLATES[0]!);
  const [accent, setAccent] = useState<string | null>(null);
  const shown = BID_TEMPLATES.filter((tpl) => category === 'All' || tpl.category === category);

  const preview = useMemo(
    () =>
      previewProposal({
        seller: {
          name: session?.tenant.name ?? t('Your company'),
          logoDataUrl: settings.data?.logoDataUrl,
          header: settings.data?.proposalHeader,
          footer: settings.data?.proposalFooter,
          brandColor: session?.tenant.brandColor,
        },
        templateKey: selected.key,
        accentColor: accent,
        title: t('{template} proposal', { template: t.maybe(selected.name) }),
        reference: t('Example'),
        preparedFor: t('Example customer'),
        currency: 'USD',
        validUntil: null,
        sections: selected.sections,
        lines: EXAMPLE_LINES,
        terms: null,
      }),
    [session, settings.data, selected, accent, t],
  );

  const choose = (tpl: BidTemplate) => {
    setSelected(tpl);
    setAccent(null);
  };
  const startHref = `/app/quotes/quick?template=${selected.key}${accent ? `&accent=${encodeURIComponent(accent)}` : ''}`;

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('Category')} className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className="h-8 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {c === 'All' ? t('All') : t.maybe(c)}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ul aria-label={t('Bid templates')} className="grid content-start gap-3 sm:grid-cols-2">
          {shown.map((tpl) => (
            <li key={tpl.key}>
              <button
                type="button"
                aria-pressed={selected.key === tpl.key}
                onClick={() => choose(tpl)}
                className="group w-full rounded-lg border border-border p-2 text-start transition-colors hover:bg-muted/50 aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <TemplateThumb template={tpl} accent={selected.key === tpl.key ? (accent ?? undefined) : undefined} />
                <span className="mt-2 flex items-center justify-between gap-2 px-1">
                  <span className="text-sm font-medium">{t.maybe(tpl.name)}</span>
                  <Badge tone="neutral">{t.maybe(tpl.category)}</Badge>
                </span>
                <span className="mt-0.5 block px-1 text-xs text-muted-foreground">{t.maybe(tpl.description)}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div>
                <h2 className="text-base font-semibold">{t.maybe(selected.name)}</h2>
                <p className="text-sm text-muted-foreground">
                  {t(selected.style.font === 'serif' ? 'Serif headings, {cover}.' : 'Sans-serif headings, {cover}.', { cover: t(COVER_LABEL[selected.style.cover]) })}{' '}
                  {t.plural('count.startingSections', selected.sections.length)}
                </p>
              </div>
              <AccentPicker value={accent} templateAccent={selected.style.accent} onChange={setAccent} />
              {canWrite ? (
                <Link
                  href={startHref}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('Use template')} <ArrowRight className="rtl:-scale-x-100 size-4" aria-hidden />
                </Link>
              ) : (
                <p className="text-xs text-muted-foreground">{t('You can browse templates. Starting a bid needs permission to write quotes.')}</p>
              )}
            </CardContent>
          </Card>
          <ProposalPreview proposal={preview} label={t('{template} example preview', { template: t.maybe(selected.name) })} />
        </div>
      </div>
    </div>
  );
}

const COVER_LABEL = { band: 'a colour band cover', dark: 'a dark cover', split: 'a side rule', minimal: 'a quiet rule under the title' } as const;
