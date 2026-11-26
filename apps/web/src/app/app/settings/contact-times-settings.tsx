'use client';

import { type ContactTimes, DEFAULT_CONTACT_TIMES, zoneAbbreviation, zoneOffset } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { Clock3 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useContactTimes, useSaveContactTimes } from '@/lib/client-time';
import { useT } from '@/lib/i18n';

const inputClass = 'h-control w-full rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function zoneList(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    return list.includes('Asia/Kolkata') ? list : ['Asia/Kolkata', ...list];
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
}

/**
 * Settings > my time zone and calling hours (ADR 0089). Saved to the person's account, so it follows them; used by the
 * client-time card on company and employee pages, and by the "good time to contact?" check.
 */
export function ContactTimesSettings() {
  const t = useT();
  const id = useId();
  const query = useContactTimes();
  const save = useSaveContactTimes();
  const [draft, setDraft] = useState<ContactTimes | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.contactTimes);
  }, [query.data, draft]);
  const zones = useMemo(() => {
    const now = new Date();
    return zoneList()
      .map((z) => ({ z, off: zoneOffset(z, now), label: `${z.replace(/_/g, ' ')} (${zoneAbbreviation(z, now)})` }))
      .sort((a, b) => a.off - b.off || a.z.localeCompare(b.z));
  }, []);
  const valid = !!draft && draft.start !== draft.end;
  const submit = (value: ContactTimes | null) => {
    setStatus('idle');
    save.mutate(value, {
      onSuccess: (res) => {
        setDraft(res.contactTimes);
        setStatus('saved');
      },
      onError: () => setStatus('error'),
    });
  };
  return (
    <Card id="contact-times" data-testid="contact-times-settings" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3 className="size-5 text-primary" aria-hidden />
          {t('Your time zone and calling hours')}
        </CardTitle>
        <CardDescription>{t('Each client’s time is shown next to yours, and SampForce suggests when to reach them. Only you see this setting.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!draft ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-zone`} className="text-sm font-medium">
                {t('Your time zone')}
              </label>
              <select id={`${id}-zone`} className={inputClass} value={draft.timeZone} onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}>
                {zones.map(({ z, label }) => (
                  <option key={z} value={z}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`${id}-start`} className="text-sm font-medium">
                  {t('I call and email from')}
                </label>
                <input id={`${id}-start`} type="time" className={inputClass} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-end`} className="text-sm font-medium">
                  {t('Until')}
                </label>
                <input id={`${id}-end`} type="time" className={inputClass} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={draft.confirmBeforeContact} onChange={(e) => setDraft({ ...draft, confirmBeforeContact: e.target.checked })} />
              <span>
                <span className="font-medium">{t('Ask “is now a good time?” before I email or call a client')}</span>
                <span className="block text-muted-foreground">{t('Shows their local time and working hours first. You can always go ahead.')}</span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!valid || save.isPending} onClick={() => submit(draft)}>
                {t('Save')}
              </Button>
              <Button variant="outline" disabled={save.isPending || query.data?.source === 'default'} onClick={() => submit(null)}>
                {t('Back to IST, 9:00 to 23:00')}
              </Button>
              {status === 'saved' && (
                <span role="status" className="text-sm text-success">
                  {t('Saved.')}
                </span>
              )}
              {status === 'error' && (
                <span role="alert" className="text-sm text-critical">
                  {t('Could not save. Try again.')}
                </span>
              )}
            </div>
            {query.data?.source === 'default' && <p className="text-xs text-muted-foreground">{t('Using the defaults: {zone}, {start} to {end}.', { zone: DEFAULT_CONTACT_TIMES.timeZone, start: DEFAULT_CONTACT_TIMES.start, end: DEFAULT_CONTACT_TIMES.end })}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
