'use client';

import { type CertificateVerification, initialsOf } from '@dealflow/types';
import { Skeleton } from '@dealflow/ui';
import { BadgeCheck, ShieldAlert, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { verifyCertificate } from '@/lib/learning';
import { dateText, pct } from './bits';
import './learning.css';

/** The public check a QR code on a certificate opens: says whether the certificate is genuine, and nothing more. */
export function VerifyCertificate({ code }: { code: string }) {
  const t = useT();
  const [v, setV] = useState<CertificateVerification | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    verifyCertificate(code).then(setV, () => setFailed(true));
  }, [code]);
  if (!v && !failed) return <Skeleton className="h-72 rounded-3xl" />;
  if (failed || !v?.valid) {
    return (
      <section className="rounded-3xl border bg-surface p-8 text-center" data-verify="invalid">
        <ShieldAlert className="mx-auto size-14 text-rose-500" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold">{t('Certificate not found')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('No certificate has the code {code}. Check the code and try again.', { code })}</p>
      </section>
    );
  }
  const revoked = !!v.revoked;
  return (
    <section className="overflow-hidden rounded-3xl border bg-surface" data-verify={revoked ? 'revoked' : 'valid'}>
      {v.brand && (
        <header className="flex items-center gap-4 border-b p-5" data-verify-brand>
          {v.brand.logoUrl ? (
            // A white chip, so a dark logo stays visible on the dark theme.
            // eslint-disable-next-line @next/next/no-img-element -- the issuing organisation's logo, served by the API
            <span className="grid h-14 max-w-[11rem] shrink-0 place-items-center rounded-xl bg-white px-2 py-1.5 shadow-sm"><img src={v.brand.logoUrl} alt={t('{name} logo', { name: v.brand.name })} className="max-h-full max-w-full object-contain" /></span>
          ) : (
            <span className="grid size-12 place-items-center rounded-full text-lg font-bold text-white" style={{ background: v.brand.primary }} aria-hidden>{initialsOf(v.brand.name)}</span>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold">{v.brand.name}</p>
            {v.brand.tagline && <p className="truncate text-sm text-muted-foreground">{v.brand.tagline}</p>}
          </div>
          <span className="ms-auto h-10 w-1.5 shrink-0 rounded-full" style={{ background: `linear-gradient(${v.brand.primary}, ${v.brand.secondary})` }} aria-hidden />
        </header>
      )}
      <div className="lrn-hero rounded-none p-8 text-center" data-tone={revoked ? 'fail' : 'pass'}>
        <div className="relative z-10">
          {revoked ? <ShieldOff className="mx-auto size-14" aria-hidden /> : <BadgeCheck className="mx-auto size-14" aria-hidden />}
          <h1 className="mt-3 text-2xl font-extrabold">{revoked ? t('This certificate was revoked') : t('Genuine certificate')}</h1>
          <p className="mt-1 text-sm text-white/85">{revoked ? t('It was issued but is no longer valid.') : t('Issued by {issuer} through SampForce.', { issuer: v.issuerName ?? '' })}</p>
        </div>
      </div>
      <dl className="grid gap-4 p-6 sm:grid-cols-2">
        {(
          [
            [t('Awarded to'), v.recipientName],
            [t('Module'), v.moduleTitle],
            [t('Score'), pct(v.score)],
            [t('Completed on'), dateText(v.completedAt)],
            [t('Certificate'), v.number],
            [t('Issued by'), v.issuerName],
          ] as const
        ).map(([k, val]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="font-semibold">{val ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
