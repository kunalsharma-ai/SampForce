'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from '@dealflow/ui';
import {
  BID_TEMPLATES,
  bidTemplate,
  type ContractRow,
  lineTotals,
  type ProposalSection,
  quoteTotals,
  type QuoteRow,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileSignature, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { ProposalSections, ProposalSharing } from './proposal-panel';
import { AccentPicker } from '@/components/bids/accent-picker';
import { api, downloadFile } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import {
  formatAmount,
  QUOTE_STATUS,
  todayIso,
  useCommercialSettings,
  useProducts,
  useQuote,
  useQuoteVersions,
  useTaxRates,
} from '@/lib/revenue';
import { useCan } from '@/lib/session';
import { useT } from '@/lib/i18n';

interface DraftLine {
  productId: string;
  quantity: string;
  discountPercent: string;
  taxRateId: string;
}

const toDraft = (q: QuoteRow): DraftLine[] =>
  q.lines.map((l) => ({
    productId: l.productId,
    quantity: String(l.quantity),
    discountPercent: String(l.discountPercent),
    taxRateId: l.taxRateId ?? '',
  }));

export function QuoteEditor({ id }: { id: string }) {
  const quote = useQuote(id);
  if (quote.isPending) return <Skeleton className="h-96" />;
  if (quote.error) return <ErrorText error={quote.error} />;
  return <Editor key={quote.data.updatedAt} quote={quote.data} />;
}

function Editor({ quote: q }: { quote: QuoteRow }) {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const canWrite = useCan('quotes:write');
  const canContract = useCan('contracts:write');
  const products = useProducts();
  const taxes = useTaxRates();
  const settings = useCommercialSettings();
  const editable = canWrite && q.isLatest && (q.status === 'DRAFT' || q.status === 'REJECTED');
  const [lines, setLines] = useState<DraftLine[]>(() => toDraft(q));
  const [title, setTitle] = useState(q.title);
  const [validUntil, setValidUntil] = useState(q.validUntil ?? '');
  const [notes, setNotes] = useState(q.notes ?? '');
  const [terms, setTerms] = useState(q.terms ?? '');
  const [sections, setSections] = useState<ProposalSection[]>(() =>
    q.sections.map((x) => ({ ...x })),
  );
  const [templateKey, setTemplateKey] = useState<string | null>(q.templateKey);
  const [accentColor, setAccentColor] = useState<string | null>(q.accentColor);
  const [updateDeal, setUpdateDeal] = useState(true);
  const [initial] = useState(() =>
    JSON.stringify({
      lines: toDraft(q),
      title: q.title,
      validUntil: q.validUntil ?? '',
      notes: q.notes ?? '',
      terms: q.terms ?? '',
      sections: q.sections,
      templateKey: q.templateKey,
      accentColor: q.accentColor,
    }),
  );
  const dirty = JSON.stringify({ lines, title, validUntil, notes, terms, sections, templateKey, accentColor }) !== initial;

  const refresh = async (next?: QuoteRow) => {
    await qc.invalidateQueries({ queryKey: ['quotes'] });
    if (next && next.id !== q.id) router.push(`/app/quotes/${next.id}`);
  };
  const save = useMutation({
    mutationFn: () =>
      api<QuoteRow>(`/quotes/${q.id}`, {
        method: 'PATCH',
        json: {
          title,
          validUntil: validUntil || null,
          notes,
          terms,
          sections,
          templateKey,
          accentColor,
          lines: lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            discountPercent: Number(l.discountPercent || 0),
            taxRateId: l.taxRateId || null,
          })),
        },
      }),
    onSuccess: () => refresh(),
  });
  const transition = useMutation({
    mutationFn: (action: string) =>
      api<QuoteRow>(`/quotes/${q.id}/transition`, {
        method: 'POST',
        json: { action, ...(action === 'accept' ? { updateDealAmount: updateDeal } : {}) },
      }),
    onSuccess: (next) => refresh(next),
  });
  const remove = useMutation({
    mutationFn: () => api(`/quotes/${q.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['quotes'] });
      router.push('/app/quotes');
    },
  });
  const contract = useMutation({
    mutationFn: () =>
      api<ContractRow>('/contracts', {
        method: 'POST',
        json: { name: q.title, quoteId: q.id, startDate: todayIso() },
      }),
    onSuccess: (c) => router.push(`/app/contracts/${c.id}`),
  });

  const productById = new Map((products.data ?? []).map((p) => [p.id, p]));
  const taxById = new Map((taxes.data ?? []).map((t) => [t.id, t]));
  const priceOf = (productId: string) =>
    productById.get(productId)?.prices.find((p) => p.priceBookId === q.priceBook.id)?.unitPrice;
  // Live preview while editing; the server recomputes from the price book on save.
  const calc = lines.map((l) => ({
    quantity: Number(l.quantity) || 0,
    unitPrice: priceOf(l.productId) ?? 0,
    discountPercent: Number(l.discountPercent) || 0,
    taxPercent: l.taxRateId ? (taxById.get(l.taxRateId)?.rate ?? 0) : 0,
  }));
  const totals = editable
    ? quoteTotals(calc)
    : {
        subtotal: q.subtotal,
        discountTotal: q.discountTotal,
        taxTotal: q.taxTotal,
        total: q.total,
        maxDiscountPercent: q.maxDiscountPercent,
      };
  const threshold = settings.data?.discountApprovalThreshold;
  const pricedProducts = (products.data ?? []).filter(
    (p) => p.active && p.prices.some((x) => x.priceBookId === q.priceBook.id),
  );
  const busy = save.isPending || transition.isPending;

  return (
    <div className="space-y-4">
      <Link
        href="/app/quotes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden /> {t('All quotes')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{q.reference}</h1>
        <Badge tone={QUOTE_STATUS[q.status].tone}>{t.maybe(QUOTE_STATUS[q.status].label)}</Badge>
        {!q.isLatest && <Badge tone="warning">{t('Superseded by a newer version')}</Badge>}
        {q.expired && <Badge tone="warning">{t('Past valid date')}</Badge>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadFile(`/quotes/${q.id}/pdf`, `${q.reference.replace(/\s+/g, '-')}.pdf`)
            }
          >
            <Download aria-hidden /> PDF
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('For')}{' '}
        <Link href={`/app/deals/${q.deal.id}`} className="text-primary underline underline-offset-2">
          {q.deal.name}
        </Link>
        {q.deal.companyName && ` · ${q.deal.companyName}`} · {t('price book {name} ({currency})', { name: q.priceBook.name, currency: q.currency })} ·{' '}
        {t('created by {name} {when}', { name: q.createdBy?.name ?? t('someone'), when: relativeTime(q.createdAt) })}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Lines')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 overflow-x-auto">
              {lines.length === 0 && !editable && (
                <p className="text-sm text-muted-foreground">{t('No lines.')}</p>
              )}
              {(editable ? lines.length > 0 : q.lines.length > 0) && (
                <table className="w-full text-sm">
                  <thead className="text-start text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">{t('Product')}</th>
                      <th className="pb-2 text-end font-medium">{t('Qty')}</th>
                      <th className="pb-2 text-end font-medium">{t('Unit price')}</th>
                      <th className="pb-2 text-end font-medium">{t('Discount %')}</th>
                      <th className="pb-2 font-medium">{t('Tax')}</th>
                      <th className="pb-2 text-end font-medium">{t('Net')}</th>
                      {editable && <th className="sr-only">{t('Remove')}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {editable
                      ? lines.map((l, i) => {
                          const set = (patch: Partial<DraftLine>) =>
                            setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                          const over =
                            threshold !== undefined && Number(l.discountPercent) > threshold;
                          return (
                            <tr key={i}>
                              <td className="py-2 pe-2">
                                <Select
                                  aria-label={t('Line {n} product', { n: i + 1 })}
                                  value={l.productId}
                                  onChange={(e) => set({ productId: e.target.value })}
                                  className="h-9 min-w-40"
                                >
                                  {!productById.has(l.productId) && (
                                    <option value={l.productId}>{t('Unknown product')}</option>
                                  )}
                                  {pricedProducts.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                              <td className="py-2 pe-2">
                                <Input
                                  aria-label={t('Line {n} quantity', { n: i + 1 })}
                                  value={l.quantity}
                                  onChange={(e) => set({ quantity: e.target.value })}
                                  inputMode="decimal"
                                  className="ms-auto h-9 w-20 text-end"
                                />
                              </td>
                              <td className="py-2 pe-2 text-end tabular-nums">
                                {formatAmount(priceOf(l.productId) ?? null, q.currency)}
                              </td>
                              <td className="py-2 pe-2">
                                <Input
                                  aria-label={t('Line {n} discount percent', { n: i + 1 })}
                                  aria-describedby={over ? `over-${i}` : undefined}
                                  value={l.discountPercent}
                                  onChange={(e) => set({ discountPercent: e.target.value })}
                                  inputMode="decimal"
                                  className="ms-auto h-9 w-20 text-end"
                                />
                                {over && (
                                  <span
                                    id={`over-${i}`}
                                    className="block text-end text-[11px] text-warning"
                                  >
                                    {t('Needs approval')}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pe-2">
                                <Select
                                  aria-label={t('Line {n} tax rate', { n: i + 1 })}
                                  value={l.taxRateId}
                                  onChange={(e) => set({ taxRateId: e.target.value })}
                                  className="h-9 w-32"
                                >
                                  <option value="">{t('No tax')}</option>
                                  {(taxes.data ?? [])
                                    .filter((r) => r.active)
                                    .map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {r.name} ({r.rate}%)
                                      </option>
                                    ))}
                                </Select>
                              </td>
                              <td className="py-2 text-end tabular-nums">
                                {formatAmount(lineTotals(calc[i]!).net, q.currency)}
                              </td>
                              <td className="py-2 ps-2">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label={t('Remove line {n}', { n: i + 1 })}
                                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                                >
                                  <Trash2 className="size-4" aria-hidden />
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      : q.lines.map((l) => (
                          <tr key={l.id}>
                            <td className="py-2 pe-2">{l.name}</td>
                            <td className="py-2 pe-2 text-end tabular-nums">{l.quantity}</td>
                            <td className="py-2 pe-2 text-end tabular-nums">
                              {formatAmount(l.unitPrice, q.currency)}
                            </td>
                            <td className="py-2 pe-2 text-end tabular-nums">
                              {l.discountPercent}%
                            </td>
                            <td className="py-2 pe-2">
                              {l.taxPercent ? `${l.taxPercent}%` : t('No tax')}
                            </td>
                            <td className="py-2 text-end tabular-nums">
                              {formatAmount(l.netTotal, q.currency)}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              )}
              {editable && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pricedProducts.length === 0}
                    onClick={() =>
                      setLines((ls) => [
                        ...ls,
                        {
                          productId: pricedProducts[0]!.id,
                          quantity: '1',
                          discountPercent: '0',
                          taxRateId: '',
                        },
                      ])
                    }
                  >
                    <Plus aria-hidden /> {t('Add line')}
                  </Button>
                  {pricedProducts.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('No products are priced in {book}. Set prices under Catalogue & pricing.', { book: q.priceBook.name })}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t('Unit prices come from the price book and cannot be typed in.')}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <ProposalSections
            dealId={q.deal.id}
            sections={editable ? sections : q.sections}
            onChange={setSections}
            editable={editable}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Details')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field id="quote-title" label={t('Title')}>
                <Input
                  id="quote-title"
                  value={title}
                  disabled={!editable}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field id="quote-valid" label={t('Valid until')}>
                <Input
                  id="quote-valid"
                  type="date"
                  value={validUntil}
                  disabled={!editable}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </Field>
              <Field id="quote-template" label={t('Bid template')} hint={t('The look of the online proposal and PDF.')}>
                <Select
                  id="quote-template"
                  value={templateKey ?? ''}
                  disabled={!editable}
                  onChange={(e) => {
                    setTemplateKey(e.target.value || null);
                    setAccentColor(null);
                  }}
                >
                  <option value="">{t('Plain (workspace brand)')}</option>
                  {BID_TEMPLATES.map((tpl) => (
                    <option key={tpl.key} value={tpl.key}>
                      {t.maybe(tpl.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              {bidTemplate(templateKey) ? (
                <AccentPicker
                  value={accentColor}
                  templateAccent={bidTemplate(templateKey)!.style.accent}
                  disabled={!editable}
                  onChange={setAccentColor}
                />
              ) : (
                <div />
              )}
              <Field id="quote-notes" label={t('Notes for the customer')} className="sm:col-span-2">
                <Textarea
                  id="quote-notes"
                  value={notes}
                  disabled={!editable}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={5000}
                />
              </Field>
              <Field id="quote-terms" label={t('Terms')} className="sm:col-span-2">
                <Textarea
                  id="quote-terms"
                  value={terms}
                  disabled={!editable}
                  onChange={(e) => setTerms(e.target.value)}
                  maxLength={5000}
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Totals')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Row label={t('Subtotal')} value={formatAmount(totals.subtotal, q.currency)} />
              <Row label={t('Discount')} value={`−${formatAmount(totals.discountTotal, q.currency)}`} />
              <Row label={t('Tax')} value={formatAmount(totals.taxTotal, q.currency)} />
              <div className="border-t border-border pt-1">
                <Row label={t('Total')} value={formatAmount(totals.total, q.currency)} strong />
              </div>
              {threshold !== undefined && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {t('Highest discount {max}% · approval needed above {threshold}%.', { max: totals.maxDiscountPercent, threshold })}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Next step')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {editable && (
                <>
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={busy || !dirty}
                    onClick={() => save.mutate()}
                  >
                    {t('Save draft')}
                  </Button>
                  <Button
                    className="w-full"
                    disabled={busy || dirty || q.lines.length === 0}
                    onClick={() => transition.mutate('submit')}
                  >
                    {t('Submit for sending')}
                  </Button>
                  {dirty && (
                    <p className="text-xs text-muted-foreground">
                      {t('Save your changes before submitting.')}
                    </p>
                  )}
                  {q.status === 'DRAFT' && q.version === 1 && (
                    <Button
                      className="w-full"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate()}
                    >
                      {t('Delete draft')}
                    </Button>
                  )}
                </>
              )}
              {q.status === 'PENDING_APPROVAL' && (
                <p>
                  {t('Waiting for someone with quotes:approve to decide. You cannot approve your own discount.')}{' '}
                  <Link href="/app/approvals" className="text-primary hover:underline">
                    {t('Open Approvals')}
                  </Link>
                </p>
              )}
              {canWrite && q.isLatest && q.status === 'APPROVED' && (
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={() => transition.mutate('mark_sent')}
                >
                  {t('Mark as sent (sent another way)')}
                </Button>
              )}
              {canWrite && q.isLatest && (q.status === 'APPROVED' || q.status === 'SENT') && (
                <>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={updateDeal}
                      onChange={(e) => setUpdateDeal(e.target.checked)}
                    />{' '}
                    {t('Set the deal amount to the quote total before tax')}
                  </label>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      variant="accent"
                      disabled={busy}
                      onClick={() => transition.mutate('accept')}
                    >
                      {t('Customer accepted')}
                    </Button>
                    <Button
                      className="flex-1"
                      variant="outline"
                      disabled={busy}
                      onClick={() => transition.mutate('decline')}
                    >
                      {t('Declined')}
                    </Button>
                  </div>
                </>
              )}
              {canWrite &&
                q.isLatest &&
                ['APPROVED', 'SENT', 'REJECTED', 'DECLINED'].includes(q.status) && (
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={busy}
                    onClick={() => transition.mutate('revise')}
                  >
                    {t('Revise (new version)')}
                  </Button>
                )}
              {q.status === 'ACCEPTED' &&
                (q.contractId ? (
                  <Link
                    href={`/app/contracts/${q.contractId}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <FileSignature className="size-4" aria-hidden /> {t('Open contract')}
                  </Link>
                ) : (
                  canContract && (
                    <Button
                      className="w-full"
                      disabled={contract.isPending}
                      onClick={() => contract.mutate()}
                    >
                      <FileSignature aria-hidden /> {t('Create contract')}
                    </Button>
                  )
                ))}
              {q.sentAt && (
                <p className="text-xs text-muted-foreground">{t('Sent {date}', { date: formatDate(q.sentAt) })}</p>
              )}
              <ErrorText error={save.error ?? transition.error ?? remove.error ?? contract.error} />
            </CardContent>
          </Card>
          <ProposalSharing quote={q} onSent={() => refresh()} />
          <Versions id={q.id} current={q.id} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between tabular-nums ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}

function Versions({ id, current }: { id: string; current: string }) {
  const t = useT();
  const versions = useQuoteVersions(id);
  if (!versions.data || versions.data.length < 2) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Versions')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {versions.data.map((v) => (
            <li key={v.id} className="flex items-center gap-2 py-2">
              {v.id === current ? (
                <span className="font-medium">v{v.version}</span>
              ) : (
                <Link href={`/app/quotes/${v.id}`} className="text-primary hover:underline">
                  v{v.version}
                </Link>
              )}
              <Badge tone={QUOTE_STATUS[v.status].tone}>{t.maybe(QUOTE_STATUS[v.status].label)}</Badge>
              <span className="ms-auto tabular-nums">{formatAmount(v.total, v.currency)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
