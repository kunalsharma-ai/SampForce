'use client';

import { Badge, Button, Card, CardContent, Skeleton } from '@dealflow/ui';
import { bidStyle, textOn, type PublicProposal } from '@dealflow/types';
import { CreditCard, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatAmount } from '@/lib/revenue';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';

type State =
  | { kind: 'loading' }
  | { kind: 'missing'; message: string | null; failed?: boolean }
  | { kind: 'ready'; p: PublicProposal };

// English keeps the day-month-year order the PDF uses; other languages follow the visitor's locale.
const dateLocale = () => (fmtLocale().startsWith('en') ? 'en-GB' : fmtLocale());

const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(dateLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The customer's view of a proposal. It talks only to the public proposal endpoints; the rep previews it with ?preview=1, which is not counted. */
export function ProposalView({ token, preview, returnedFromPayment = false }: { token: string; preview: boolean; returnedFromPayment?: boolean }) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const loaded = useRef(false);
  const base = `/api/v1/proposals/view/${encodeURIComponent(token)}`;

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    fetch(`${base}${preview ? '?preview=1' : ''}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as
          | (PublicProposal & { error?: { message: string } })
          | null;
        if (r.ok && body) setState({ kind: 'ready', p: body });
        else
          setState({
            kind: 'missing',
            message: body?.error?.message ?? null,
          });
      })
      .catch(() =>
        setState({
          kind: 'missing',
          message: null,
          failed: true,
        }),
      );
  }, [base, preview]);

  const p = state.kind === 'ready' ? state.p : null;
  const waitingForConfirmation = returnedFromPayment && !!p?.payment && !p.payment.paid;
  // Back from the provider's page: the payment counts only once the provider's webhook confirms it, so check a few times.
  useEffect(() => {
    if (!waitingForConfirmation) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      fetch(`${base}?preview=1`)
        .then((r) => (r.ok ? (r.json() as Promise<PublicProposal>) : null))
        .then((next) => {
          if (next?.payment?.paid) setState({ kind: 'ready', p: next });
        })
        .catch(() => undefined);
      if (tries >= 10) window.clearInterval(id);
    }, 3000);
    return () => window.clearInterval(id);
  }, [waitingForConfirmation, base]);

  if (state.kind === 'loading') return <Skeleton className="h-96 w-full" />;
  if (state.kind === 'missing')
    return (
      <Card>
        <CardContent className="p-6 text-sm">{state.message ? t.maybe(state.message) : state.failed ? t('This proposal could not be loaded. Please try again.') : t('This proposal is not available.')}</CardContent>
      </Card>
    );

  return (
    <ProposalDocument
      p={state.p}
      banner={
        preview && (
          <p className="rounded-md bg-muted p-2 text-xs">
            {t('Preview. This visit is not counted as a view.')}
          </p>
        )
      }
      actions={
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {state.p.payment && (
            <PayByCard
              base={base}
              p={state.p}
              preview={preview}
              waiting={waitingForConfirmation}
            />
          )}
          <Button asChild variant="outline" size="sm">
            <a href={`${base}/pdf`} download>
              <Download aria-hidden /> {t('Download PDF')}
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('To accept or ask a question, reply to the email this link came in.')}
          </p>
        </div>
      }
    />
  );
}

const PROVIDER_NAME = { stripe: 'Stripe', razorpay: 'Razorpay' } as const;

/** Card payment into the seller's own Stripe or Razorpay account, on the provider's hosted page. */
function PayByCard({ base, p, preview, waiting }: { base: string; p: PublicProposal; preview: boolean; waiting: boolean }) {
  const t = useT();
  const pay = p.payment!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = PROVIDER_NAME[pay.provider];
  if (pay.paid)
    return (
      <p className="flex items-center gap-2 text-sm" role="status">
        <Badge tone="success">{t('Paid')}</Badge>
        {pay.paidAt && t('Payment confirmed by {provider} on {date}.', { provider: name, date: fmtDate(pay.paidAt) })}
      </p>
    );
  if (waiting)
    return (
      <p className="text-sm" role="status">
        {t('Thank you. {provider} is confirming your payment; this page updates when it does. You will not be charged twice if you leave.', { provider: name })}
      </p>
    );
  if (!pay.available) return pay.reason ? <p className="text-xs text-muted-foreground">{pay.reason}</p> : null;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${base}/pay`, { method: 'POST' });
      const body = (await r.json().catch(() => null)) as { url?: string; error?: { message: string } } | null;
      if (r.ok && body?.url) {
        window.location.assign(body.url);
        return;
      }
      setError(body?.error?.message ? t.maybe(body.error.message) : t('Card payment is not available right now.'));
    } catch {
      setError(t('Card payment could not be started. Please try again.'));
    }
    setBusy(false);
  };
  return (
    <div className="space-y-1">
      <Button size="sm" onClick={start} disabled={busy || preview} aria-describedby="pay-note">
        <CreditCard aria-hidden /> {busy ? t('Opening payment page…') : t('Pay {amount} by card', { amount: formatAmount(p.total, p.currency) })}
      </Button>
      <p id="pay-note" className="text-xs text-muted-foreground">
        {preview ? t('Preview: your customer sees this button. It is turned off here.') : t("You pay on {provider}'s secure page. {seller} never sees your card details.", { provider: name, seller: p.seller.name })}
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The proposal itself: shared by the link view and the client portal, which bring their own actions. */
export function ProposalDocument({ p, banner, actions }: { p: PublicProposal; banner?: React.ReactNode; actions?: React.ReactNode }) {
  const t = useT();
  // The bid template look: accent for bands and rules, a serif or sans heading face, and a cover style.
  // Text stays in the theme's colours so a pale accent never makes it unreadable.
  const style = p.style ?? bidStyle(null, null, p.seller.brandColor);
  const heading = style.font === 'serif' ? 'font-serif' : '';
  const banded = style.cover === 'band' || style.cover === 'dark';
  const bandText = style.cover === 'dark' ? '#ffffff' : textOn(style.accent);
  return (
    <article
      className="space-y-6"
      data-template={style.templateKey ?? 'default'}
      data-cover={style.cover}
      style={{ '--proposal-accent': style.accent } as React.CSSProperties}
    >
      <header
        className={
          banded
            ? 'space-y-2 rounded-lg p-6'
            : style.cover === 'split'
              ? 'space-y-2 border-s-8 py-2 ps-5'
              : 'space-y-2 border-b-2 pb-4'
        }
        style={
          banded
            ? {
                background: style.cover === 'dark' ? '#111111' : style.accent,
                color: bandText,
                borderTop: style.cover === 'dark' ? `4px solid ${style.accent}` : undefined,
              }
            : { borderColor: 'var(--proposal-accent)' }
        }
      >
        {p.seller.logoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- the seller's stored logo as a data URL
          <img
            src={p.seller.logoDataUrl}
            alt={t('{name} logo', { name: p.seller.name })}
            className={banded ? 'h-14 max-w-60 rounded bg-white p-1 object-contain' : 'h-14 max-w-60 object-contain'}
          />
        )}
        <p className={`text-sm font-medium ${heading}`}>{p.seller.name}</p>
        {p.seller.header && <p className={banded ? 'text-xs' : 'text-xs text-muted-foreground'}>{p.seller.header}</p>}
      </header>

      {banner}
      {p.superseded && (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          {t('A newer version of this proposal has been prepared. Ask {seller} for the latest link.', { seller: p.seller.name })}
        </p>
      )}

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={`text-2xl font-semibold tracking-tight ${heading}`}>{p.title}</h1>
          {p.status === 'ACCEPTED' && <Badge tone="success">{t('Accepted')}</Badge>}
          {p.status === 'DECLINED' && <Badge tone="neutral">{t('Declined')}</Badge>}
          {p.expired && <Badge tone="warning">{t('Past its valid date')}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {p.reference}
          {p.preparedFor && ` · ${t('prepared for {name}', { name: p.preparedFor })}`} · {fmtDate(p.createdAt)}
          {p.validUntil && ` · ${t('valid until {date}', { date: fmtDate(p.validUntil) })}`}
        </p>
      </div>

      {p.sections.map((s, i) => (
        <section key={i} className="space-y-1">
          <h2 className={`border-s-4 ps-3 text-lg font-semibold ${heading}`} style={{ borderColor: 'var(--proposal-accent)' }}>
            {s.heading}
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.body}</p>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className={`border-s-4 ps-3 text-lg font-semibold ${heading}`} style={{ borderColor: 'var(--proposal-accent)' }}>
          {t('Pricing')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">{t('Item')}</th>
                <th className="pb-2 text-end font-medium">{t('Qty')}</th>
                <th className="pb-2 text-end font-medium">{t('Unit price')}</th>
                <th className="pb-2 text-end font-medium">{t('Discount')}</th>
                <th className="pb-2 text-end font-medium">{t('Tax')}</th>
                <th className="pb-2 text-end font-medium">{t('Net')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-2 pe-2">
                    {l.name}
                    {l.description && (
                      <span className="block text-xs text-muted-foreground">{l.description}</span>
                    )}
                  </td>
                  <td className="py-2 pe-2 text-end tabular-nums">{l.quantity}</td>
                  <td className="py-2 pe-2 text-end tabular-nums">
                    {formatAmount(l.unitPrice, p.currency)}
                  </td>
                  <td className="py-2 pe-2 text-end tabular-nums">
                    {l.discountPercent ? `${l.discountPercent}%` : '—'}
                  </td>
                  <td className="py-2 pe-2 text-end tabular-nums">
                    {l.taxPercent ? `${l.taxPercent}%` : '—'}
                  </td>
                  <td className="py-2 text-end tabular-nums">
                    {formatAmount(l.netTotal, p.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ms-auto max-w-64 space-y-1 text-sm tabular-nums">
          <p className="flex justify-between">
            <span>{t('Subtotal')}</span>
            <span>{formatAmount(p.subtotal, p.currency)}</span>
          </p>
          {p.discountTotal > 0 && (
            <p className="flex justify-between">
              <span>{t('Discount')}</span>
              <span>−{formatAmount(p.discountTotal, p.currency)}</span>
            </p>
          )}
          <p className="flex justify-between">
            <span>{t('Tax')}</span>
            <span>{formatAmount(p.taxTotal, p.currency)}</span>
          </p>
          <p className="flex justify-between border-t-2 pt-1 font-semibold" style={{ borderColor: 'var(--proposal-accent)' }}>
            <span>{t('Total')}</span>
            <span>{formatAmount(p.total, p.currency)}</span>
          </p>
        </div>
      </section>

      {p.terms && (
        <section className="space-y-1">
          <h2 className={`text-lg font-semibold ${heading}`}>{t('Terms')}</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{p.terms}</p>
        </section>
      )}

      {actions}
      {p.seller.footer && (
        <footer className="text-xs text-muted-foreground">{p.seller.footer}</footer>
      )}
    </article>
  );
}
