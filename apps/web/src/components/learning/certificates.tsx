'use client';

import type { CertificateRow } from '@dealflow/types';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Award, Copy, Download, ExternalLink, Medal, Printer, ShieldCheck, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { certificatePdfUrl, LEARNING_KEY, learningApi, useManage, useMyLearning, useTeamCertificates } from '@/lib/learning';
import { dateText, EmptyState, ErrorLine, pct } from './bits';

/** The person's certificates, and for managers the certificates of their people. */
export function CertificatesPage() {
  const t = useT();
  const params = useSearchParams();
  const mine = useMyLearning();
  const manage = useManage(!!mine.data?.canManage);
  const team = useTeamCertificates(!!mine.data?.canManage);
  const [open, setOpen] = useState<CertificateRow | null>(null);
  const all = [...(mine.data?.certificates ?? []), ...(team.data ?? [])];

  useEffect(() => {
    const id = params.get('open');
    if (id && !open) {
      const c = all.find((x) => x.id === id);
      if (c) setOpen(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when the lists arrive
  }, [params, mine.data, team.data]);

  if (mine.isLoading) return <Skeleton className="h-80 rounded-2xl" />;
  if (mine.error) return <ErrorLine error={mine.error} />;
  const own = mine.data?.certificates ?? [];
  const others = (team.data ?? []).filter((c) => !own.some((o) => o.id === c.id));
  return (
    <div className="space-y-6" data-certificates>
      <Link href="/app/learning" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t('My learning')}</Link>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('My certificates')}</h2>
        {own.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {own.map((c) => <CertificateTile key={c.id} c={c} onOpen={() => setOpen(c)} />)}
          </div>
        ) : (
          <EmptyState icon={Award} title={t('No certificates yet')} body={t('Pass a module that awards a certificate and it appears here, ready to download and share.')} />
        )}
      </section>
      {mine.data?.canManage && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('My team’s certificates')}</h2>
          {team.isLoading ? (
            <Skeleton className="h-40" />
          ) : others.length ? (
            <div className="overflow-x-auto rounded-2xl border bg-surface">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3 text-start">{t('Certificate')}</th>
                    <th className="p-3 text-start">{t('Person')}</th>
                    <th className="p-3 text-start">{t('Module')}</th>
                    <th className="p-3 text-end">{t('Score')}</th>
                    <th className="p-3 text-start">{t('Issued')}</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {others.map((c) => (
                    <tr key={c.id}>
                      <td className="p-3 font-mono text-xs">{c.number}{c.revoked && <Badge tone="critical" className="ms-2">{t('Revoked')}</Badge>}</td>
                      <td className="p-3">{c.recipientName}</td>
                      <td className="p-3">{c.moduleTitle}</td>
                      <td className="p-3 text-end tabular-nums">{pct(c.score)}</td>
                      <td className="p-3">{dateText(c.issuedAt)}</td>
                      <td className="p-3 text-end"><Button size="sm" variant="outline" onClick={() => setOpen(c)}>{t('View')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Nobody in your team has a certificate yet.')}</p>
          )}
        </section>
      )}
      {open && <CertificateDialog c={open} canRevoke={!!manage.data?.canConfigure} onClose={() => setOpen(null)} onChanged={setOpen} />}
    </div>
  );
}

function CertificateTile({ c, onOpen }: { c: CertificateRow; onOpen: () => void }) {
  const t = useT();
  return (
    <button onClick={onOpen} className="lrn-card text-start" style={{ ['--lrn-accent' as string]: c.accentColor }} data-certificate={c.number}>
      <div className="lrn-cover grid place-items-center" style={{ height: '6rem' }}>
        <Medal className="relative z-10 size-12 text-amber-300 drop-shadow" aria-hidden />
      </div>
      <div className="space-y-1 p-4">
        <p className="line-clamp-2 font-semibold">{c.moduleTitle}</p>
        <p className="text-xs text-muted-foreground">{c.number} · {dateText(c.issuedAt)}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-bold" style={{ color: c.accentColor }}>{pct(c.score)}</span>
          {c.revoked ? <Badge tone="critical">{t('Revoked')}</Badge> : <Badge tone="success">{t('Valid')}</Badge>}
        </div>
      </div>
    </button>
  );
}

/** The certificate as it looks on paper, with download, print and the verification link. */
export function CertificateView({ c }: { c: CertificateRow }) {
  const t = useT();
  return (
    <div className="lrn-cert lrn-print relative aspect-[1.414] w-full overflow-hidden p-[5%] text-center" data-template={c.template} style={{ ['--lrn-cert' as string]: c.accentColor }}>
      {c.revoked && <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="-rotate-12 rounded-lg border-4 border-rose-500 px-6 py-2 text-4xl font-black uppercase tracking-widest text-rose-500/70">{t('Revoked')}</span></div>}
      <p className="text-[clamp(0.6rem,1.4vw,0.85rem)] font-semibold uppercase tracking-[0.3em]" style={{ color: c.template === 'EXECUTIVE' ? '#c9a227' : c.accentColor }}>{c.issuerName}</p>
      <h3 className="mt-[3%] font-serif text-[clamp(1.1rem,3.6vw,2.4rem)] font-bold">{t('Certificate of Completion')}</h3>
      <p className="mt-[3%] text-[clamp(0.6rem,1.3vw,0.9rem)] opacity-75">{t('This certifies that')}</p>
      <p className="mt-[1.5%] font-serif text-[clamp(1rem,3.2vw,2.1rem)] font-semibold italic">{c.recipientName}</p>
      <p className="mt-[1.5%] text-[clamp(0.6rem,1.3vw,0.9rem)] opacity-75">{t('has successfully completed')}</p>
      <p className="mt-[1%] text-[clamp(0.8rem,2vw,1.3rem)] font-bold">{c.moduleTitle}</p>
      <p className="mt-[1.5%] text-[clamp(0.6rem,1.3vw,0.9rem)]">{t('with a score of {score} on {date}', { score: pct(c.score), date: dateText(c.completedAt) })}</p>
      <div className="absolute inset-x-[6%] bottom-[7%] flex items-end justify-between text-[clamp(0.5rem,1.1vw,0.75rem)]">
        <div className="text-start">
          <p className="font-mono">{c.number}</p>
          <p className="font-mono opacity-70">{t('Code {code}', { code: c.code })}</p>
        </div>
        <div className="grid size-[clamp(2.5rem,7vw,4.5rem)] place-items-center rounded-full text-white shadow" style={{ background: `radial-gradient(circle at 30% 30%, #fde68a, ${c.template === 'EXECUTIVE' ? '#c9a227' : c.accentColor})` }}>
          <Award className="size-1/2" aria-hidden />
        </div>
        <div className="text-end">
          {c.signatoryName && <p className="border-t border-current pt-1 font-semibold">{c.signatoryName}</p>}
          {c.signatoryTitle && <p className="opacity-70">{c.signatoryTitle}</p>}
        </div>
      </div>
    </div>
  );
}

function CertificateDialog({ c, canRevoke, onClose, onChanged }: { c: CertificateRow; canRevoke: boolean; onClose: () => void; onChanged: (c: CertificateRow) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    learningApi.certificate(c.id).then((x) => setVerifyUrl(x.verifyUrl), () => setVerifyUrl(null));
  }, [c.id]);
  const copy = async () => {
    if (!verifyUrl) return;
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const revoke = async () => {
    setError(null);
    try {
      const out = await learningApi.revokeCertificate(c.id, !c.revoked);
      onChanged(out);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'certificates'] });
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'me'] });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">{c.moduleTitle}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('Certificate {number} for {name}', { number: c.number, name: c.recipientName })}</DialogDescription>
        <div className="my-4"><CertificateView c={c} /></div>
        <div className="flex flex-wrap gap-2">
          <Button asChild><a href={certificatePdfUrl(c.id, true)} data-download-certificate><Download className="size-4" aria-hidden />{t('Download PDF')}</a></Button>
          <Button asChild variant="outline"><a href={certificatePdfUrl(c.id)} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden />{t('Open PDF')}</a></Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="size-4" aria-hidden />{t('Print')}</Button>
          {verifyUrl && <Button variant="outline" onClick={copy}><Copy className="size-4" aria-hidden />{copied ? t('Link copied') : t('Copy verification link')}</Button>}
          {canRevoke && (
            <Button variant={c.revoked ? 'outline' : 'destructive'} onClick={revoke} className="ms-auto">
              {c.revoked ? <ShieldCheck className="size-4" aria-hidden /> : <ShieldOff className="size-4" aria-hidden />}
              {c.revoked ? t('Restore certificate') : t('Revoke certificate')}
            </Button>
          )}
        </div>
        {verifyUrl && <p className="mt-2 break-all text-xs text-muted-foreground">{t('Anyone can check it at {url}', { url: verifyUrl })}</p>}
        <ErrorLine error={error} />
      </DialogContent>
    </Dialog>
  );
}
