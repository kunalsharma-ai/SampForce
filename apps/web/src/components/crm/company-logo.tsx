'use client';

import { useCanDelete } from '@/lib/features';
import type { CompanyLogoRef, CompanyRow } from '@dealflow/types';
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { countryName } from '@/components/forms/locale-data';
import { useCompanyLogoMutations } from '@/lib/company-leads';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/**
 * A company's logo (ADR 0070) on a white tile, with a monogram in the company's own colour while no logo is known.
 * On the profile a small round country flag sits on the tile's corner. The logo is found from the website
 * automatically, so the tile shimmers while that look-up is still running.
 */

const SIZES = {
  xs: { box: 'size-7 rounded-lg', inner: 22, text: 'text-[0.65rem]', flag: 'size-3.5 text-[0.875rem]' },
  sm: { box: 'size-10 rounded-xl', inner: 32, text: 'text-sm', flag: 'size-4 text-[1rem]' },
  md: { box: 'size-14 rounded-2xl', inner: 44, text: 'text-lg', flag: 'size-5 text-[1.25rem]' },
  xl: { box: 'size-20 rounded-3xl sm:size-24', inner: 76, text: 'text-3xl', flag: 'size-7 text-[1.75rem] sm:size-8 sm:text-[2rem]' },
} as const;
export type CompanyLogoSize = keyof typeof SIZES;

/** Legal suffixes left out of the monogram ("Acme Ltd" is "A", not "AL"). */
const SUFFIXES = new Set(['inc', 'inc.', 'ltd', 'ltd.', 'llc', 'llp', 'plc', 'gmbh', 'ag', 'sa', 'sas', 'srl', 'bv', 'nv', 'pvt', 'pvt.', 'private', 'limited', 'co', 'co.', 'corp', 'corp.', 'corporation', 'company', 'the', '&', 'and', 'pte', 'pty', 'llc.', 'oy', 'ab', 'as', 'kk']);

export function monogram(name: string): string {
  const words = name
    .replace(/[()[\]{}"'.,]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w.toLowerCase()));
  const letters = (words.length ? words : [name.trim()]).slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
}

/** A stable hue per company name, so the same company always gets the same monogram colour. */
export function nameHue(name: string): number {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

export function CompanyLogo({
  company,
  size = 'sm',
  flag = false,
  className,
}: {
  company: { name: string; logo?: CompanyLogoRef | null; country?: string | null };
  size?: CompanyLogoSize;
  /** Show the small country flag badge (the profile header). */
  flag?: boolean;
  className?: string;
}) {
  const t = useT();
  const s = SIZES[size];
  const url = company.logo?.url ?? null;
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => setBroken(null), [url]);
  const showImage = !!url && broken !== url;
  const pending = company.logo?.status === 'PENDING';
  const hue = nameHue(company.name);
  // Small icons (favicons) are drawn no bigger than twice their size, so they stay crisp instead of blurring.
  const width = company.logo?.width ?? null;
  const drawn = width === null ? s.inner : Math.min(s.inner, Math.max(width * 2, Math.round(s.inner * 0.5)));
  const country = flag && company.country ? countryName(company.country, t.formatLocale) : null;

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'relative inline-flex items-center justify-center overflow-hidden ring-1 ring-black/5 shadow-sm dark:ring-white/10',
          s.box,
          size === 'xl' && 'shadow-lg shadow-primary/10',
          showImage ? 'bg-white' : 'text-white',
        )}
        style={
          showImage
            ? undefined
            : { backgroundImage: `linear-gradient(135deg, hsl(${hue} 72% 46%), hsl(${(hue + 40) % 360} 78% 34%))` }
        }
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image, already sized
          <img
            src={url}
            alt={t('{name} logo', { name: company.name })}
            width={drawn}
            height={drawn}
            loading={size === 'xl' ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            onError={() => setBroken(url)}
            className="object-contain"
            style={{ width: drawn, height: drawn }}
          />
        ) : (
          <span aria-hidden className={cn('select-none font-bold tracking-tight drop-shadow-sm', s.text)}>
            {monogram(company.name)}
          </span>
        )}
        {size === 'xl' && !showImage && <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-black/10" />}
        {pending && !showImage && (
          <span className="absolute inset-0 animate-pulse bg-white/25" role="status">
            <span className="sr-only">{t('Finding the logo from the website…')}</span>
          </span>
        )}
      </span>
      {country && (
        <span
          className={cn(
            'fi fis absolute -bottom-1 -end-1 overflow-hidden rounded-full bg-surface shadow-md ring-2 ring-surface',
            `fi-${company.country!.toLowerCase()}`,
            s.flag,
          )}
          role="img"
          aria-label={country}
          title={country}
        />
      )}
    </span>
  );
}

/**
 * The profile header's logo with its menu: upload a logo (it then wins over the website's), go back to the
 * website's logo, or look it up again. Polls while the automatic look-up is still running.
 */
export function CompanyLogoEditor({ company }: { company: CompanyRow }) {
  const t = useT();
  const qc = useQueryClient();
  const canWrite = useCan('companies:write') && !company.restricted;
  const mayDelete = useCanDelete('account_management');
  const { upload, remove, lookAgain } = useCompanyLogoMutations(company.id);
  const input = useRef<HTMLInputElement>(null);
  const status = company.logo?.status;
  const uploaded = company.logo?.source === 'UPLOAD';
  const hasWebsite = !!(company.website || company.domain);

  // The worker usually finds the logo within seconds: check again a few times, then stop.
  useEffect(() => {
    if (status !== 'PENDING') return;
    let n = 0;
    const timer = setInterval(() => {
      if (++n > 20) clearInterval(timer);
      void qc.invalidateQueries({ queryKey: ['companies', 'detail', company.id] });
    }, 3000);
    return () => clearInterval(timer);
  }, [status, company.id, qc]);

  const error = upload.error ?? remove.error ?? lookAgain.error;
  const busy = upload.isPending || remove.isPending || lookAgain.isPending;
  const hint =
    status === 'PENDING'
      ? t('Finding the logo from the website…')
      : uploaded
        ? t('Uploaded logo')
        : status === 'FOUND'
          ? t('Logo from the company’s website')
          : status === 'NOT_FOUND' || status === 'FAILED'
            ? t('No logo found on the website')
            : null;

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="group relative">
        <span aria-hidden className="absolute -inset-1.5 rounded-[1.75rem] bg-gradient-to-br from-primary/40 via-accent/30 to-primary/10 blur-md" />
        <CompanyLogo company={company} size="xl" flag className="relative" />
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy}
                className="absolute -end-2 -top-2 inline-flex size-8 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-md transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                aria-label={t('Change logo')}
                title={t('Change logo')}
              >
                {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Camera aria-hidden className="size-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => input.current?.click()}>
                <Upload aria-hidden className="size-4" /> {t('Upload logo')}
              </DropdownMenuItem>
              {!uploaded && hasWebsite && (
                <DropdownMenuItem onSelect={() => lookAgain.mutate()}>
                  <RefreshCw aria-hidden className="size-4" /> {t('Find the logo on the website again')}
                </DropdownMenuItem>
              )}
              {uploaded && mayDelete && (
                <DropdownMenuItem onSelect={() => remove.mutate()}>
                  <Trash2 aria-hidden className="size-4" /> {hasWebsite ? t('Use the website’s logo instead') : t('Remove logo')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('Upload logo')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload.mutate(file);
          }}
        />
      </div>
      {hint && <span className="max-w-28 text-center text-[0.7rem] leading-tight text-muted-foreground">{hint}</span>}
      {error && (
        <span role="alert" className="max-w-40 text-center text-xs text-critical">
          {error.message}
        </span>
      )}
    </div>
  );
}
