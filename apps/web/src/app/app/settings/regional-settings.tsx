'use client';

import { FORMAT_LOCALES, LANGUAGES, type LanguageCode, languageDir, type Regional, resolveFormatLocale } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { Languages } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { translatePlural } from '@/lib/i18n/translate';
import { regionalSaves, useRegionalQuery, useResetRegional, useSaveRegional } from '@/lib/regional-sync';
import { InfoTip } from '@/components/info-tip';

const selectClass =
  'h-control w-full rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function localeName(tag: string, inLanguage: string): string {
  try {
    return new Intl.DisplayNames([inLanguage], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** A fixed moment so the preview reads the same for everyone: 1 November 2026, 14:30 UTC. */
const SAMPLE = new Date(Date.UTC(2026, 10, 1, 14, 30));

function preview(r: Regional) {
  const locale = resolveFormatLocale(r, typeof navigator === 'undefined' ? [] : navigator.languages ?? []);
  return {
    locale,
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }).format(SAMPLE),
    number: new Intl.NumberFormat(locale).format(1234567.891),
    money: new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(24000.5),
    relative: translatePlural(r.language, 'regional.days', 3, undefined, locale),
  };
}

/** Saving a new language remounts the page, so the confirmation is driven by the save time rather than local state. */
const SAVED_SHOWN_MS = 6000;

/** Settings > Language & region: saved to the person's account (PUT /me/regional) and applied once saved. */
export function RegionalSettings() {
  const t = useT();
  const id = useId();
  const query = useRegionalQuery();
  const save = useSaveRegional();
  const reset = useResetRegional();
  const [draft, setDraft] = useState<Regional | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>(() => (Date.now() - regionalSaves.at < SAVED_SHOWN_MS ? 'saved' : 'idle'));

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.regional);
  }, [query.data, draft]);

  const p = useMemo(() => (draft ? preview(draft) : null), [draft]);
  const autoLocale = useMemo(() => (draft ? resolveFormatLocale({ ...draft, formatLocale: null }, typeof navigator === 'undefined' ? [] : navigator.languages ?? []) : ''), [draft]);
  const changed = !!draft && !!query.data && (draft.language !== query.data.regional.language || draft.formatLocale !== query.data.regional.formatLocale);
  const busy = save.isPending || reset.isPending;

  const onSave = () => {
    if (!draft) return;
    setStatus('idle');
    save.mutate(draft, {
      onSuccess: () => setStatus('saved'),
      onError: () => setStatus('error'),
    });
  };
  const onReset = () => {
    setStatus('idle');
    reset.mutate(undefined, {
      onSuccess: (res) => {
        setDraft(res.regional);
        setStatus('saved');
      },
      onError: () => setStatus('error'),
    });
  };

  return (
    <Card data-testid="regional-settings">
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Languages className="size-5 text-primary" aria-hidden />
            {t('regional.title')}
          </CardTitle>
          <InfoTip topic="settings.regional" />
        </div>
        <CardDescription>{t('regional.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!draft || !p ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`${id}-lang`} className="text-sm font-medium">
                  {t('regional.language')}
                </label>
                <select
                  id={`${id}-lang`}
                  className={selectClass}
                  value={draft.language}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, language: e.target.value as LanguageCode })}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code} lang={l.code}>
                      {l.code === 'en' ? l.name : `${l.name} · ${l.english}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-fmt`} className="text-sm font-medium">
                  {t('regional.formats')}
                </label>
                <select
                  id={`${id}-fmt`}
                  className={selectClass}
                  value={draft.formatLocale ?? ''}
                  disabled={busy}
                  aria-describedby={`${id}-fmt-hint`}
                  onChange={(e) => setDraft({ ...draft, formatLocale: e.target.value || null })}
                >
                  <option value="">{t('regional.formatsAuto', { locale: localeName(autoLocale, t.language) })}</option>
                  {[...FORMAT_LOCALES]
                    .map((tag) => ({ tag, name: localeName(tag, t.language) }))
                    .sort((a, b) => a.name.localeCompare(b.name, t.language))
                    .map(({ tag, name }) => (
                      <option key={tag} value={tag}>
                        {name} ({tag})
                      </option>
                    ))}
                </select>
                <p id={`${id}-fmt-hint`} className="text-xs text-muted-foreground">
                  {t('regional.formatsHint')}
                </p>
              </div>
            </div>

            <section aria-labelledby={`${id}-pv`} className="rounded-lg border border-border bg-muted/30 p-4">
              <h3 id={`${id}-pv`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('regional.preview')} · <span dir="ltr">{p.locale}</span>
              </h3>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]" data-testid="regional-preview" lang={p.locale} dir={languageDir(draft.language)}>
                <dt className="text-muted-foreground">{t('regional.previewDate')}</dt>
                <dd data-preview="date">{p.date}</dd>
                <dt className="text-muted-foreground">{t('regional.previewNumber')}</dt>
                <dd data-preview="number" className="tabular-nums">{p.number}</dd>
                <dt className="text-muted-foreground">{t('regional.previewMoney')}</dt>
                <dd data-preview="money" className="tabular-nums">{p.money}</dd>
                <dt className="text-muted-foreground">{t('regional.previewRelative')}</dt>
                <dd data-preview="relative">{p.relative}</dd>
              </dl>
            </section>

            {languageDir(draft.language) === 'rtl' && <p className="text-sm text-muted-foreground">{t('regional.rtl')}</p>}
            <p className="text-xs text-muted-foreground">{t('regional.coverage')}</p>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={onSave} disabled={!changed || busy}>
                {save.isPending ? t('regional.saving') : t('regional.save')}
              </Button>
              {query.data?.source === 'user' && (
                <Button type="button" variant="outline" onClick={onReset} disabled={busy}>
                  {t('regional.reset')}
                </Button>
              )}
              <p aria-live="polite" data-testid="regional-status" className={status === 'error' ? 'text-sm text-critical' : 'text-sm text-muted-foreground'}>
                {status === 'saved' ? t('regional.saved') : status === 'error' ? t('regional.saveError') : ''}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
