'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { HELP_TOPICS, type HelpId, type HelpTopic, PAGE_HELP, helpText } from '@/lib/help';
import { useT } from '@/lib/i18n';

/** Which page a section topic belongs to, by the prefix of its id (`quote.lines` → the quote page). */
const SECTION_PAGES: Record<string, HelpId[]> = {
  commandCenter: ['page.commandCenter'],
  record: ['page.leadRecord', 'page.contactRecord', 'page.companyRecord', 'page.dealRecord'],
  lead: ['page.leadRecord'],
  deal: ['page.dealRecord'],
  deals: ['page.deals'],
  activities: ['page.activities'],
  sequences: ['page.sequenceEditor'],
  prospects: ['page.prospectList'],
  visitors: ['page.websiteVisitors'],
  marketing: ['page.marketing'],
  quotes: ['page.quotes'],
  quote: ['page.quoteEditor'],
  contract: ['page.contractRecord'],
  revenue: ['page.revenue'],
  agents: ['page.agents'],
  automation: ['page.workflowEditor'],
  forecasting: ['page.forecasting'],
  reports: ['page.reports'],
  gamification: ['page.gamification'],
  team: ['page.team'],
  integrations: ['page.integrations'],
  billing: ['page.billing'],
  settings: ['page.settings'],
  theme: ['page.themeStudio'],
  admin: ['page.administration'],
  security: ['page.workspaceSecurity'],
  account: ['page.accountSecurity'],
};

interface GuidePage {
  id: HelpId;
  href?: string;
  topic: HelpTopic;
  sections: { id: HelpId; topic: HelpTopic }[];
}

/** Every signed-in page once, in sidebar order, with a link where the page has a fixed address. */
function guidePages(): GuidePage[] {
  const pages = new Map<HelpId, GuidePage>();
  for (const [route, id] of Object.entries(PAGE_HELP)) {
    if (!route.startsWith('/app') || pages.has(id)) continue;
    pages.set(id, { id, href: route.includes('[') ? undefined : route, topic: HELP_TOPICS[id], sections: [] });
  }
  for (const id of Object.keys(HELP_TOPICS) as HelpId[]) {
    if (id.startsWith('page.')) continue;
    for (const page of SECTION_PAGES[id.split('.')[0]!] ?? []) pages.get(page)?.sections.push({ id, topic: HELP_TOPICS[id] });
  }
  return [...pages.values()];
}

/** The Help center's searchable guide to every page and section, built from the same text as the "i" buttons. */
export function FeatureGuide() {
  const t = useT();
  const [query, setQuery] = useState('');
  const all = useMemo(guidePages, []);
  const text = (h: HelpTopic) => [t.maybe(h.title), helpText(h.what, t.language), helpText(h.how, t.language), helpText(h.where, t.language)];
  const q = query.trim().toLocaleLowerCase(t.language);
  const shown = q
    ? all.filter((p) => [p.topic, ...p.sections.map((s) => s.topic)].some((h) => text(h).some((x) => x.toLocaleLowerCase(t.language).includes(q))))
    : all;

  return (
    <Card id="guide" className="mt-6">
      <CardHeader>
        <CardTitle>{t('Feature guide')}</CardTitle>
        <CardDescription>{t('What every page and section is for, how to use it and when it helps. The same help opens from the i button next to each title.')}</CardDescription>
        <div className="relative pt-2">
          <Search className="pointer-events-none absolute start-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search features')} aria-label={t('Search features')} className="ps-9" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="sr-only" aria-live="polite">
          {q && shown.length === 0 ? t('No feature matches “{query}”.', { query }) : ''}
        </p>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground" aria-hidden>{t('No feature matches “{query}”.', { query })}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((p) => (
              <li key={p.id} className="space-y-2 py-4 first:pt-0" data-help-guide={p.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{t.maybe(p.topic.title)}</h3>
                  {p.href && (
                    <Link href={p.href} className="text-sm text-primary underline underline-offset-2">
                      {t('Open page')}
                    </Link>
                  )}
                </div>
                <Explanation topic={p.topic} />
                {p.sections.length > 0 && (
                  <details className="rounded-md border border-border bg-muted/30 px-3 py-2" open={q.length > 0}>
                    <summary className="cursor-pointer text-sm font-medium">{t('Sections on this page')}</summary>
                    <ul className="mt-2 space-y-3">
                      {p.sections.map((s) => (
                        <li key={s.id}>
                          <h4 className="text-sm font-medium">{t.maybe(s.topic.title)}</h4>
                          <Explanation topic={s.topic} />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Explanation({ topic }: { topic: HelpTopic }) {
  const t = useT();
  return (
    <dl className="grid gap-1 text-sm sm:grid-cols-[9rem_1fr] sm:gap-x-3">
      <dt className="text-muted-foreground">{t('What it is for')}</dt>
      <dd>{helpText(topic.what, t.language)}</dd>
      <dt className="text-muted-foreground">{t('How to use it')}</dt>
      <dd>{helpText(topic.how, t.language)}</dd>
      <dt className="text-muted-foreground">{t('Where to use it')}</dt>
      <dd>{helpText(topic.where, t.language)}</dd>
    </dl>
  );
}
