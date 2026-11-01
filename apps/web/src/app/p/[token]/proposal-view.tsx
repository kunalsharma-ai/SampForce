'use client';

import { Badge, Button, Card, CardContent, Skeleton } from '@dealflow/ui';
import type { PublicProposal } from '@dealflow/types';
import { CreditCard, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatAmount } from '@/lib/revenue';

type State =
  | { kind: 'loading' }
  | { kind: 'missing'; message: string }
  | { kind: 'ready'; p: PublicProposal };

const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The customer's view of a proposal. It talks only to the public proposal endpoints; the rep previews it with ?preview=1, which is not counted. */
export function ProposalView({ token, preview, returnedFromPayment = false }: { token: string; preview: boolean; returnedFromPayment?: boolean }) {
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
            message: body?.error?.message ?? 'This proposal is not available.',
          });
      })
      .catch(() =>
        setState({
          kind: 'missing',
          message: 'This proposal could not be loaded. Please try again.',
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
        <CardContent className="p-6 text-sm">{state.message}</CardContent>
      </Card>
    );

  return (
    <ProposalDocument
      p={state.p}
      banner={
        preview && (
          <p className="rounded-md bg-muted p-2 text-xs">
            Preview. This visit is not counted as a view.
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
              <Download aria-hidden /> Download PDF
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            To accept or ask a question, reply to the email this link came in.
          </p>
        </div>
      }
    />
  );
}

const PROVIDER_NAME = { stripe: 'Stripe', razorpay: 'Razorpay' } as const;

/** Card payment into the seller's own Stripe or Razorpay account, on the provider's hosted page. */
function PayByCard({ base, p, preview, waiting }: { base: string; p: PublicProposal; preview: boolean; waiting: boolean }) {
  const pay = p.payment!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = PROVIDER_NAME[pay.provider];
  if (pay.paid)
    return (
      <p className="flex items-center gap-2 text-sm" role="status">
        <Badge tone="success">Paid</Badge>
        {pay.paidAt && `Payment confirmed by ${name} on ${fmtDate(pay.paidAt)}.`}
      </p>
    );
  if (waiting)
    return (
      <p className="text-sm" role="status">
        Thank you. {name} is confirming your payment; this page updates when it does. You will not
        be charged twice if you leave.
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
      setError(body?.error?.message ?? 'Card payment is not available right now.');
    } catch {
      setError('Card payment could not be started. Please try again.');
    }
    setBusy(false);
  };
  return (
    <div className="space-y-1">
      <Button size="sm" onClick={start} disabled={busy || preview} aria-describedby="pay-note">
        <CreditCard aria-hidden /> {busy ? 'Opening payment page…' : `Pay ${formatAmount(p.total, p.currency)} by card`}
      </Button>
      <p id="pay-note" className="text-xs text-muted-foreground">
        {preview ? 'Preview: your customer sees this button. It is turned off here.' : `You pay on ${name}'s secure page. ${p.seller.name} never sees your card details.`}
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
  return (
    <article
      className="space-y-6"
      style={
        p.seller.brandColor
          ? ({ '--proposal-accent': p.seller.brandColor } as React.CSSProperties)
          : undefined
      }
    >
      <header
        className="space-y-2 border-b-4 pb-4"
        style={{ borderColor: 'var(--proposal-accent, currentColor)' }}
      >
        {p.seller.logoDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- the seller's stored logo as a data URL
          <img
            src={p.seller.logoDataUrl}
            alt={`${p.seller.name} logo`}
            className="h-14 max-w-60 object-contain"
          />
        )}
        <p className="text-sm font-medium">{p.seller.name}</p>
        {p.seller.header && <p className="text-xs text-muted-foreground">{p.seller.header}</p>}
      </header>

      {banner}
      {p.superseded && (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          A newer version of this proposal has been prepared. Ask {p.seller.name} for the latest
          link.
        </p>
      )}

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
          {p.status === 'ACCEPTED' && <Badge tone="success">Accepted</Badge>}
          {p.status === 'DECLINED' && <Badge tone="neutral">Declined</Badge>}
          {p.expired && <Badge tone="warning">Past its valid date</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {p.reference}
          {p.preparedFor && ` · prepared for ${p.preparedFor}`} · {fmtDate(p.createdAt)}
          {p.validUntil && ` · valid until ${fmtDate(p.validUntil)}`}
        </p>
      </div>

      {p.sections.map((s, i) => (
        <section key={i} className="space-y-1">
          <h2 className="text-lg font-semibold">{s.heading}</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.body}</p>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pricing</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="pb-2 text-right font-medium">Unit price</th>
                <th className="pb-2 text-right font-medium">Discount</th>
                <th className="pb-2 text-right font-medium">Tax</th>
                <th className="pb-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-2 pr-2">
                    {l.name}
                    {l.description && (
                      <span className="block text-xs text-muted-foreground">{l.description}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatAmount(l.unitPrice, p.currency)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {l.discountPercent ? `${l.discountPercent}%` : '—'}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {l.taxPercent ? `${l.taxPercent}%` : '—'}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatAmount(l.netTotal, p.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto max-w-64 space-y-1 text-sm tabular-nums">
          <p className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatAmount(p.subtotal, p.currency)}</span>
          </p>
          {p.discountTotal > 0 && (
            <p className="flex justify-between">
              <span>Discount</span>
              <span>−{formatAmount(p.discountTotal, p.currency)}</span>
            </p>
          )}
          <p className="flex justify-between">
            <span>Tax</span>
            <span>{formatAmount(p.taxTotal, p.currency)}</span>
          </p>
          <p className="flex justify-between border-t border-border pt-1 font-semibold">
            <span>Total</span>
            <span>{formatAmount(p.total, p.currency)}</span>
          </p>
        </div>
      </section>

      {p.terms && (
        <section className="space-y-1">
          <h2 className="text-lg font-semibold">Terms</h2>
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
