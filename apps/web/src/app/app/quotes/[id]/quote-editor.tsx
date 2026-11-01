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
        <ArrowLeft className="size-4" aria-hidden /> All quotes
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{q.reference}</h1>
        <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>
        {!q.isLatest && <Badge tone="warning">Superseded by a newer version</Badge>}
        {q.expired && <Badge tone="warning">Past valid date</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
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
        For{' '}
        <Link href={`/app/deals/${q.deal.id}`} className="text-primary underline underline-offset-2">
          {q.deal.name}
        </Link>
        {q.deal.companyName && ` · ${q.deal.companyName}`} · price book {q.priceBook.name} (
        {q.currency}) · created by {q.createdBy?.name ?? 'someone'} {relativeTime(q.createdAt)}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lines</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 overflow-x-auto">
              {lines.length === 0 && !editable && (
                <p className="text-sm text-muted-foreground">No lines.</p>
              )}
              {(editable ? lines.length > 0 : q.lines.length > 0) && (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2 font-medium">Product</th>
                      <th className="pb-2 text-right font-medium">Qty</th>
                      <th className="pb-2 text-right font-medium">Unit price</th>
                      <th className="pb-2 text-right font-medium">Discount %</th>
                      <th className="pb-2 font-medium">Tax</th>
                      <th className="pb-2 text-right font-medium">Net</th>
                      {editable && <th className="sr-only">Remove</th>}
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
                              <td className="py-2 pr-2">
                                <Select
                                  aria-label={`Line ${i + 1} product`}
                                  value={l.productId}
                                  onChange={(e) => set({ productId: e.target.value })}
                                  className="h-9 min-w-40"
                                >
                                  {!productById.has(l.productId) && (
                                    <option value={l.productId}>Unknown product</option>
                                  )}
                                  {pricedProducts.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                              <td className="py-2 pr-2">
                                <Input
                                  aria-label={`Line ${i + 1} quantity`}
                                  value={l.quantity}
                                  onChange={(e) => set({ quantity: e.target.value })}
                                  inputMode="decimal"
                                  className="ml-auto h-9 w-20 text-right"
                                />
                              </td>
                              <td className="py-2 pr-2 text-right tabular-nums">
                                {formatAmount(priceOf(l.productId) ?? null, q.currency)}
                              </td>
                              <td className="py-2 pr-2">
                                <Input
                                  aria-label={`Line ${i + 1} discount percent`}
                                  aria-describedby={over ? `over-${i}` : undefined}
                                  value={l.discountPercent}
                                  onChange={(e) => set({ discountPercent: e.target.value })}
                                  inputMode="decimal"
                                  className="ml-auto h-9 w-20 text-right"
                                />
                                {over && (
                                  <span
                                    id={`over-${i}`}
                                    className="block text-right text-[11px] text-warning"
                                  >
                                    Needs approval
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-2">
                                <Select
                                  aria-label={`Line ${i + 1} tax rate`}
                                  value={l.taxRateId}
                                  onChange={(e) => set({ taxRateId: e.target.value })}
                                  className="h-9 w-32"
                                >
                                  <option value="">No tax</option>
                                  {(taxes.data ?? [])
                                    .filter((t) => t.active)
                                    .map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name} ({t.rate}%)
                                      </option>
                                    ))}
                                </Select>
                              </td>
                              <td className="py-2 text-right tabular-nums">
                                {formatAmount(lineTotals(calc[i]!).net, q.currency)}
                              </td>
                              <td className="py-2 pl-2">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Remove line ${i + 1}`}
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
                            <td className="py-2 pr-2">{l.name}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{l.quantity}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {formatAmount(l.unitPrice, q.currency)}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {l.discountPercent}%
                            </td>
                            <td className="py-2 pr-2">
                              {l.taxPercent ? `${l.taxPercent}%` : 'No tax'}
                            </td>
                            <td className="py-2 text-right tabular-nums">
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
                    <Plus aria-hidden /> Add line
                  </Button>
                  {pricedProducts.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No products are priced in {q.priceBook.name}. Set prices under Catalogue &amp;
                      pricing.
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Unit prices come from the price book and cannot be typed in.
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
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field id="quote-title" label="Title">
                <Input
                  id="quote-title"
                  value={title}
                  disabled={!editable}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field id="quote-valid" label="Valid until">
                <Input
                  id="quote-valid"
                  type="date"
                  value={validUntil}
                  disabled={!editable}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </Field>
              <Field id="quote-template" label="Bid template" hint="The look of the online proposal and PDF.">
                <Select
                  id="quote-template"
                  value={templateKey ?? ''}
                  disabled={!editable}
                  onChange={(e) => {
                    setTemplateKey(e.target.value || null);
                    setAccentColor(null);
                  }}
                >
                  <option value="">Plain (workspace brand)</option>
                  {BID_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}
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
              <Field id="quote-notes" label="Notes for the customer" className="sm:col-span-2">
                <Textarea
                  id="quote-notes"
                  value={notes}
                  disabled={!editable}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={5000}
                />
              </Field>
              <Field id="quote-terms" label="Terms" className="sm:col-span-2">
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
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Row label="Subtotal" value={formatAmount(totals.subtotal, q.currency)} />
              <Row label="Discount" value={`−${formatAmount(totals.discountTotal, q.currency)}`} />
              <Row label="Tax" value={formatAmount(totals.taxTotal, q.currency)} />
              <div className="border-t border-border pt-1">
                <Row label="Total" value={formatAmount(totals.total, q.currency)} strong />
              </div>
              {threshold !== undefined && (
                <p className="pt-2 text-xs text-muted-foreground">
                  Highest discount {totals.maxDiscountPercent}% · approval needed above {threshold}
                  %.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Next step</CardTitle>
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
                    Save draft
                  </Button>
                  <Button
                    className="w-full"
                    disabled={busy || dirty || q.lines.length === 0}
                    onClick={() => transition.mutate('submit')}
                  >
                    Submit for sending
                  </Button>
                  {dirty && (
                    <p className="text-xs text-muted-foreground">
                      Save your changes before submitting.
                    </p>
                  )}
                  {q.status === 'DRAFT' && q.version === 1 && (
                    <Button
                      className="w-full"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate()}
                    >
                      Delete draft
                    </Button>
                  )}
                </>
              )}
              {q.status === 'PENDING_APPROVAL' && (
                <p>
                  Waiting for someone with quotes:approve to decide in{' '}
                  <Link href="/app/approvals" className="text-primary hover:underline">
                    Approvals
                  </Link>
                  . You cannot approve your own discount.
                </p>
              )}
              {canWrite && q.isLatest && q.status === 'APPROVED' && (
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={() => transition.mutate('mark_sent')}
                >
                  Mark as sent (sent another way)
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
                    Set the deal amount to the quote total before tax
                  </label>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      variant="accent"
                      disabled={busy}
                      onClick={() => transition.mutate('accept')}
                    >
                      Customer accepted
                    </Button>
                    <Button
                      className="flex-1"
                      variant="outline"
                      disabled={busy}
                      onClick={() => transition.mutate('decline')}
                    >
                      Declined
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
                    Revise (new version)
                  </Button>
                )}
              {q.status === 'ACCEPTED' &&
                (q.contractId ? (
                  <Link
                    href={`/app/contracts/${q.contractId}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <FileSignature className="size-4" aria-hidden /> Open contract
                  </Link>
                ) : (
                  canContract && (
                    <Button
                      className="w-full"
                      disabled={contract.isPending}
                      onClick={() => contract.mutate()}
                    >
                      <FileSignature aria-hidden /> Create contract
                    </Button>
                  )
                ))}
              {q.sentAt && (
                <p className="text-xs text-muted-foreground">Sent {formatDate(q.sentAt)}</p>
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
  const versions = useQuoteVersions(id);
  if (!versions.data || versions.data.length < 2) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Versions</CardTitle>
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
              <Badge tone={QUOTE_STATUS[v.status].tone}>{QUOTE_STATUS[v.status].label}</Badge>
              <span className="ml-auto tabular-nums">{formatAmount(v.total, v.currency)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
