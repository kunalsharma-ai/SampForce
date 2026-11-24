'use client';

import { type CompanyRow, ENRICH_FIELD_LABELS, ENRICH_FIELDS, type EnrichmentFill, type EnrichmentRun, FIELD_SOURCE_LABELS, type FieldConfidence } from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { ExternalLink, Loader2, Sparkles, Undo2 } from 'lucide-react';
import * as React from 'react';
import { InfoTip } from '@/components/info-tip';
import { ApiError } from '@/lib/api';
import { useCompanyEnrichment, useEnrichCompany, useUndoEnrichment } from '@/lib/company-enrichment';
import { useHasFeature } from '@/lib/features';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { focusSection, useCompanyAction } from './company-actions';

const TRIGGER_LABEL = {
  CREATE: 'when the company was added',
  IMPORT: 'when the company was imported',
  MANUAL: 'when Enrich was selected',
  WEBSITE_CHANGED: 'when the website changed',
} as const;

/** Fields listed before "Show all". */
const FIRST_SHOWN = 6;

const CONFIDENCE: Record<FieldConfidence, { label: string; tone: 'success' | 'neutral' | 'warning' } | null> = {
  high: null,
  medium: null,
  low: { label: 'Best guess', tone: 'neutral' },
  uncertain: { label: 'Uncertain', tone: 'warning' },
};

/** "Could not reach x.com" is stored in English with the site in it; everything else is a fixed sentence. */
function runError(t: ReturnType<typeof useT>, error: string): string {
  const reach = /^Could not reach (.+)$/.exec(error);
  return reach ? t('Could not reach {site}', { site: reach[1]! }) : t.maybe(error);
}

/**
 * Company auto-fill (ADR 0076) on the company page: the Enrich button, whether a look-up is running, and what the
 * last look-up filled, each value with where it came from and an Undo. Auto-fill never changes what someone entered.
 */
export function CompanyAutofill({ company }: { company: CompanyRow }) {
  const t = useT();
  const enabled = useHasFeature('company_enrichment');
  const canWrite = useCan('companies:write');
  const state = useCompanyEnrichment(company.id, enabled);
  const [expanded, setExpanded] = React.useState(false);
  const enrich = useEnrichCompany(company.id);
  const undo = useUndoEnrichment(company.id);
  const canEnrich = enabled && canWrite && !!state.data?.canRun && !state.data.busy;
  const run = React.useCallback(() => {
    focusSection('company-autofill', 'button');
    enrich.mutate();
  }, [enrich]);
  useCompanyAction('enrich', canEnrich ? run : null);
  if (!enabled) return null;
  if (state.isPending) return <Skeleton className="h-28 w-full" />;
  if (state.error) return null;
  const s = state.data;
  const latest = s.runs[0] ?? null;
  const shown = s.runs.find((r) => r.fills.length) ?? null;
  const live = shown ? shown.fills.filter((f) => !f.undone) : [];
  const failure = enrich.error ?? undo.error;
  const groups = groupByField(live);
  return (
    <Card id="company-autofill" aria-busy={s.busy}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles aria-hidden className="size-4" /> {t('Auto-fill')} <InfoTip topic="crm.companyAutofill" />
        </CardTitle>
        {canWrite && (
          <Button size="sm" variant="outline" disabled={!canEnrich || enrich.isPending} onClick={() => enrich.mutate()}>
            {s.busy || enrich.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />} {t('Enrich')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Status run={latest} busy={s.busy} canRun={s.canRun} />
        {failure && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-2">
            {failure instanceof ApiError ? failure.message : t('Something went wrong. Please try again.')}
          </p>
        )}
        {shown && live.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground">
                {t('Filled {when}, {trigger}:', { when: relativeTime(shown.finishedAt ?? shown.createdAt, Date.now(), t.formatLocale), trigger: t(TRIGGER_LABEL[shown.trigger]) })}
              </p>
              {canWrite && live.length > 1 && (
                <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate({ runId: shown.id })}>
                  <Undo2 aria-hidden /> {t('Undo all')}
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border rounded-md border border-border" aria-label={t('Details auto-fill added')}>
              {(expanded ? groups : groups.slice(0, FIRST_SHOWN)).map(([field, fills]) => (
                <li key={field} className="space-y-1 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t.maybe(ENRICH_FIELD_LABELS[field])}</span>
                    {canWrite && (
                      <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" disabled={undo.isPending} aria-label={t('Undo {field}', { field: t.maybe(ENRICH_FIELD_LABELS[field]) })} onClick={() => undo.mutate({ runId: shown.id, fields: [field] })}>
                        <Undo2 aria-hidden /> {t('Undo')}
                      </Button>
                    )}
                  </div>
                  <ul className="space-y-0.5">
                    {fills.map((f, i) => (
                      <li key={i} className="line-clamp-3 break-words [overflow-wrap:anywhere]" title={f.display}>
                        {f.display}
                      </li>
                    ))}
                  </ul>
                  <SourceLine fill={fills[0]!} />
                </li>
              ))}
            </ul>
            {groups.length > FIRST_SHOWN && (
              <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                {expanded ? t('Show fewer') : t('Show all {count}', { count: groups.length })}
              </Button>
            )}
          </>
        )}
        {shown && live.length === 0 && shown.fills.length > 0 && <p className="text-muted-foreground">{t('Everything the last look-up filled was undone or changed since.')}</p>}
        {latest && latest.sources.length > 0 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">{t('Pages read ({count})', { count: latest.sources.length })}</summary>
            <ul className="mt-1 space-y-0.5">
              {latest.sources.map((src) => (
                <li key={src.url}>
                  <a className="inline-flex items-center gap-1 break-all text-primary hover:underline" href={src.url} target="_blank" rel="noopener noreferrer">
                    {src.kind === 'WIKIDATA' ? 'Wikidata' : src.url.replace(/^https?:\/\//, '')} <ExternalLink aria-hidden className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function Status({ run, busy, canRun }: { run: EnrichmentRun | null; busy: boolean; canRun: boolean }) {
  const t = useT();
  if (busy) {
    return (
      <p role="status" className="flex items-center gap-2">
        <Loader2 aria-hidden className="size-4 animate-spin" /> {t('Looking this company up on its website and Wikidata…')}
      </p>
    );
  }
  if (!run) {
    return <p className="text-muted-foreground">{canRun ? t('Not looked up yet. Select Enrich to fill empty details from the company’s website and Wikidata.') : t('Add the company’s website to fill empty details automatically.')}</p>;
  }
  const when = relativeTime(run.finishedAt ?? run.createdAt, Date.now(), t.formatLocale);
  if (run.status === 'FAILED' || (run.status === 'NOTHING_FOUND' && run.error)) return <p role="status">{t('The last look-up, {when}, found nothing: {reason}', { when, reason: runError(t, run.error ?? 'Nothing could be read.') })}</p>;
  if (run.status === 'NOTHING_FOUND') return <p role="status" className="text-muted-foreground">{t('Looked up {when}: nothing new to add. Fields you filled stay as they are.', { when })}</p>;
  return (
    <p role="status" className="text-muted-foreground">
      {t('Looked up {when}: {count} details added.', { when, count: run.fills.length })}
    </p>
  );
}

function SourceLine({ fill }: { fill: EnrichmentFill }) {
  const t = useT();
  const c = CONFIDENCE[fill.confidence];
  const label = t.maybe(FIELD_SOURCE_LABELS[fill.source]);
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Badge tone="primary">{t('Auto')}</Badge>
      {fill.url ? (
        <a className="inline-flex items-center gap-1 hover:underline" href={fill.url} target="_blank" rel="noopener noreferrer" title={fill.url}>
          {label} <ExternalLink aria-hidden className="size-3" />
        </a>
      ) : (
        <span>{label}</span>
      )}
      {c && <Badge tone={c.tone}>{t.maybe(c.label)}</Badge>}
    </span>
  );
}

function groupByField(fills: EnrichmentFill[]): [EnrichmentFill['field'], EnrichmentFill[]][] {
  const groups = new Map<EnrichmentFill['field'], EnrichmentFill[]>();
  for (const f of fills) groups.set(f.field, [...(groups.get(f.field) ?? []), f]);
  return [...groups].sort(([a], [b]) => ENRICH_FIELDS.indexOf(a) - ENRICH_FIELDS.indexOf(b));
}
