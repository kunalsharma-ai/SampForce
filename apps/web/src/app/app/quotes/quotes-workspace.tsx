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
import type { PriceBookRow, ProductRow, QuoteRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RecordPicker, type PickerValue } from '@/components/crm/record-picker';
import { Select } from '@/components/crm/select';
import { UploadZone } from '@/components/forms/upload-zone';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import {
  formatAmount,
  QUOTE_STATUS,
  useCommercialSettings,
  usePriceBooks,
  useProducts,
  useQuotes,
  useTaxRates,
} from '@/lib/revenue';
import { useCan } from '@/lib/session';
import { useT } from '@/lib/i18n';

export function QuotesWorkspace() {
  const t = useT();
  const [tab, setTab] = useState<'quotes' | 'catalogue'>('quotes');
  return (
    <>
      <Tabs
        label={t('Quotes sections')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'quotes', label: t('Quotes') },
          { key: 'catalogue', label: t('Catalogue & pricing') },
        ]}
      />
      {tab === 'quotes' ? <QuoteList /> : <Catalogue />}
    </>
  );
}

function QuoteList() {
  const t = useT();
  const [status, setStatus] = useState('');
  const quotes = useQuotes({ status: status || undefined });
  const canWrite = useCan('quotes:write');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="quote-status" label={t('Status')}>
          <Select
            id="quote-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-48"
          >
            <option value="">{t('All statuses')}</option>
            {Object.entries(QUOTE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {t.maybe(v.label)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {canWrite && <NewQuote />}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {quotes.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : quotes.error ? (
            <div className="p-4">
              <ErrorText error={quotes.error} />
            </div>
          ) : quotes.data.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t('No quotes yet. Start one from a deal.')}
            </p>
          ) : (
            <QuoteTable rows={quotes.data} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function QuoteTable({ rows, showDeal = true }: { rows: QuoteRow[]; showDeal?: boolean }) {
  const t = useT();
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border text-start text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2 font-medium">{t('Quote')}</th>
          {showDeal && <th className="px-4 py-2 font-medium">{t('Deal')}</th>}
          <th className="px-4 py-2 font-medium">{t('Status')}</th>
          <th className="px-4 py-2 text-end font-medium">{t('Total')}</th>
          <th className="px-4 py-2 font-medium">{t('Valid until')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((q) => (
          <tr key={q.id}>
            <td className="px-4 py-2">
              <Link
                href={`/app/quotes/${q.id}`}
                className="font-medium text-primary hover:underline"
              >
                {q.reference}
              </Link>
              <span className="block text-xs text-muted-foreground">{q.title}</span>
            </td>
            {showDeal && (
              <td className="px-4 py-2">
                <Link href={`/app/deals/${q.deal.id}`} className="hover:underline">
                  {q.deal.name}
                </Link>
                {q.deal.companyName && (
                  <span className="block text-xs text-muted-foreground">{q.deal.companyName}</span>
                )}
              </td>
            )}
            <td className="px-4 py-2">
              <Badge tone={QUOTE_STATUS[q.status].tone}>{t.maybe(QUOTE_STATUS[q.status].label)}</Badge>
              {q.expired && (
                <Badge tone="warning" className="ms-1">
                  {t('Past valid date')}
                </Badge>
              )}
            </td>
            <td className="px-4 py-2 text-end tabular-nums">
              {formatAmount(q.total, q.currency)}
            </td>
            <td className="px-4 py-2">{formatDate(q.validUntil)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Starts a draft quote for a deal and opens the editor. */
export function NewQuote({ deal: fixedDeal }: { deal?: PickerValue }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [deal, setDeal] = useState<PickerValue | null>(fixedDeal ?? null);
  const create = useMutation({
    mutationFn: () =>
      api<QuoteRow>('/quotes', { method: 'POST', json: { opportunityId: deal!.id } }),
    onSuccess: async (q) => {
      await qc.invalidateQueries({ queryKey: ['quotes'] });
      router.push(`/app/quotes/${q.id}`);
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (deal) create.mutate();
      }}
    >
      {!fixedDeal && (
        <Field id="new-quote-deal" label={t('Deal')} className="w-72">
          <RecordPicker
            id="new-quote-deal"
            entity="deals"
            value={deal}
            onChange={setDeal}
            placeholder={t('Search deals')}
          />
        </Field>
      )}
      <Button type="submit" size="sm" disabled={!deal || create.isPending}>
        <Plus aria-hidden /> {t('New quote')}
      </Button>
      <div className="w-full">
        <ErrorText error={create.error} />
      </div>
    </form>
  );
}

function Catalogue() {
  const t = useT();
  const canManage = useCan('catalog:manage');
  const products = useProducts();
  const books = usePriceBooks();
  return (
    <div className="space-y-4">
      {!canManage && (
        <p className="text-sm text-muted-foreground">
          {t('You can view the catalogue. Changing products, prices and tax rates needs the catalog:manage permission.')}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Products
            products={products.data}
            books={books.data}
            canManage={canManage}
            loading={products.isPending || books.isPending}
          />
        </div>
        <div className="space-y-4">
          <PriceBooks books={books.data} canManage={canManage} />
          <TaxRates canManage={canManage} />
          <Settings canManage={canManage} />
          <Branding canManage={canManage} />
        </div>
      </div>
    </div>
  );
}

function Products({
  products,
  books,
  canManage,
  loading,
}: {
  products?: ProductRow[];
  books?: PriceBookRow[];
  canManage: boolean;
  loading: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api('/catalog/products', { method: 'POST', json: { name, sku: sku || null } }),
    onSuccess: async () => {
      setName('');
      setSku('');
      await qc.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
  const setPrice = useMutation({
    mutationFn: (v: { book: string; product: string; unitPrice: number }) =>
      api(`/catalog/price-books/${v.book}/prices/${v.product}`, {
        method: 'PUT',
        json: { unitPrice: v.unitPrice },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog'] }),
  });
  const activeBooks = (books ?? []).filter((b) => b.active);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Products and prices')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-24" />
        ) : !products?.length ? (
          <p className="text-sm text-muted-foreground">{t('No products yet.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">{t('Product')}</th>
                  {activeBooks.map((b) => (
                    <th key={b.id} className="pb-2 text-end font-medium">
                      {b.name} ({b.currency})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pe-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[p.sku, t('per {unit}', { unit: t.maybe(p.unit) }), !p.active && t('inactive')]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    {activeBooks.map((b) => {
                      const price = p.prices.find((x) => x.priceBookId === b.id);
                      return (
                        <td key={b.id} className="py-2 text-end">
                          {canManage ? (
                            <PriceInput
                              label={t('{product} price in {book}', { product: p.name, book: b.name })}
                              value={price?.unitPrice ?? null}
                              onSave={(unitPrice) =>
                                setPrice.mutate({ book: b.id, product: p.id, unitPrice })
                              }
                            />
                          ) : (
                            <span className="tabular-nums">
                              {price ? formatAmount(price.unitPrice, b.currency) : t('Not priced')}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorText error={setPrice.error} />
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) add.mutate();
            }}
          >
            <Field id="product-name" label={t('New product')}>
              <Input
                id="product-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                className="w-56"
              />
            </Field>
            <Field id="product-sku" label={t('SKU (optional)')}>
              <Input
                id="product-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                maxLength={64}
                className="w-32"
              />
            </Field>
            <Button type="submit" size="sm" disabled={!name.trim() || add.isPending}>
              {t('Add product')}
            </Button>
            <div className="w-full">
              <ErrorText error={add.error} />
            </div>
          </form>
        )}
        {canManage && (
          <p className="text-xs text-muted-foreground">
            {t('Price changes are recorded in the audit log. Existing quotes keep their prices; a revision picks up the new price.')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PriceInput({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (v: number) => void;
}) {
  const t = useT();
  const [text, setText] = useState(value === null ? '' : String(value));
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== value) onSave(n);
  };
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder={t('Not priced')}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="ms-auto h-8 w-28 text-end tabular-nums"
    />
  );
}

function PriceBooks({ books, canManage }: { books?: PriceBookRow[]; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api('/catalog/price-books', {
        method: 'POST',
        json: {
          name,
          currency,
          isDefault: !(books ?? []).some(
            (b) => b.currency === currency.toUpperCase() && b.isDefault,
          ),
        },
      }),
    onSuccess: async () => {
      setName('');
      setCurrency('');
      await qc.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Price books')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!books?.length ? (
          <p className="text-muted-foreground">
            {t("No price books. Quotes need one in the deal's currency.")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {books.map((b) => (
              <li key={b.id} className="flex items-center gap-2 py-2">
                <span className="font-medium">{b.name}</span>
                <Badge>{b.currency}</Badge>
                {b.isDefault && <Badge tone="primary">{t('Default')}</Badge>}
                {!b.active && <Badge tone="warning">{t('Inactive')}</Badge>}
                <span className="ms-auto text-xs text-muted-foreground">{t.plural('count.prices', b.entryCount)}</span>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && currency.trim()) add.mutate();
            }}
          >
            <Field id="book-name" label={t('Name')}>
              <Input
                id="book-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-36"
                maxLength={120}
              />
            </Field>
            <Field id="book-currency" label={t('Currency')}>
              <Input
                id="book-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-20 uppercase"
                maxLength={3}
                placeholder="USD"
              />
            </Field>
            <Button type="submit" size="sm" variant="outline" disabled={add.isPending}>
              {t('Add')}
            </Button>
            <div className="w-full">
              <ErrorText error={add.error} />
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function TaxRates({ canManage }: { canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const rates = useTaxRates();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api('/catalog/tax-rates', { method: 'POST', json: { name, rate: Number(rate) } }),
    onSuccess: async () => {
      setName('');
      setRate('');
      await qc.invalidateQueries({ queryKey: ['catalog', 'tax-rates'] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Tax rates')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!rates.data?.length ? (
          <p className="text-muted-foreground">{t('No tax rates. Lines without a rate carry no tax.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rates.data.map((r) => (
              <li key={r.id} className="flex py-2">
                <span>{r.name}</span>
                <span className="ms-auto tabular-nums">{r.rate}%</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {t('You set the rates; DealFlow does not look up or validate tax rules for any country.')}
        </p>
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && rate !== '') add.mutate();
            }}
          >
            <Field id="tax-name" label={t('Name')}>
              <Input
                id="tax-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-32"
                maxLength={80}
              />
            </Field>
            <Field id="tax-rate" label={t('Rate %')}>
              <Input
                id="tax-rate"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-20"
                inputMode="decimal"
              />
            </Field>
            <Button type="submit" size="sm" variant="outline" disabled={add.isPending}>
              {t('Add')}
            </Button>
            <div className="w-full">
              <ErrorText error={add.error} />
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Settings({ canManage }: { canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const settings = useCommercialSettings();
  const [threshold, setThreshold] = useState<string | null>(null);
  const [validity, setValidity] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api('/catalog/settings', {
        method: 'PATCH',
        json: {
          ...(threshold !== null ? { discountApprovalThreshold: Number(threshold) } : {}),
          ...(validity !== null ? { quoteValidityDays: Number(validity) } : {}),
        },
      }),
    onSuccess: async () => {
      setThreshold(null);
      setValidity(null);
      await qc.invalidateQueries({ queryKey: ['catalog', 'settings'] });
    },
  });
  if (!settings.data) return <Skeleton className="h-32" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Quote rules')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field
            id="discount-threshold"
            label={t('Discount needing approval (above %)')}
            hint={t('Any line discount above this needs someone with quotes:approve.')}
          >
            <Input
              id="discount-threshold"
              disabled={!canManage}
              value={threshold ?? String(settings.data.discountApprovalThreshold)}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              className="w-24"
            />
          </Field>
          <Field id="quote-validity" label={t('Quotes valid for (days)')}>
            <Input
              id="quote-validity"
              disabled={!canManage}
              value={validity ?? String(settings.data.quoteValidityDays)}
              onChange={(e) => setValidity(e.target.value)}
              inputMode="numeric"
              className="w-24"
            />
          </Field>
          {canManage && (
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={save.isPending || (threshold === null && validity === null)}
            >
              {t('Save rules')}
            </Button>
          )}
          <ErrorText error={save.error} />
        </form>
      </CardContent>
    </Card>
  );
}

/** Proposal branding: a logo, a header line and a footer printed on online proposals and their PDFs. */
function Branding({ canManage }: { canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const settings = useCommercialSettings();
  const [header, setHeader] = useState<string | null>(null);
  const [footer, setFooter] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [fileError, setFileError] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api('/catalog/settings', {
        method: 'PATCH',
        json: {
          ...(header !== null ? { proposalHeader: header } : {}),
          ...(footer !== null ? { proposalFooter: footer } : {}),
          ...(logo !== undefined ? { logoDataUrl: logo } : {}),
        },
      }),
    onSuccess: async () => {
      setHeader(null);
      setFooter(null);
      setLogo(undefined);
      await qc.invalidateQueries({ queryKey: ['catalog', 'settings'] });
    },
  });
  if (!settings.data) return <Skeleton className="h-32" />;
  const shownLogo = logo === undefined ? settings.data.logoDataUrl : logo;
  const pick = (file: File | undefined) => {
    setFileError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type))
      return setFileError(t('Use a PNG or JPEG image.'));
    if (file.size > 250_000) return setFileError(t('Use a logo under 250 KB.'));
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Proposal branding')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('Logo')}</p>
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored data URL, not a remote image
              <img
                src={shownLogo}
                alt={t('Current proposal logo')}
                className="h-12 max-w-48 object-contain"
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t('No logo yet.')}</p>
            )}
            {canManage && (
              <>
                <UploadZone
                  label={t('Upload a logo')}
                  accept={['image/png', 'image/jpeg']}
                  maxBytes={250_000}
                  hint={t('PNG or JPEG up to 250 KB. It is printed on proposals and their PDFs.')}
                  onFile={pick}
                />
                {shownLogo && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLogo(null)}>
                    {t('Remove logo')}
                  </Button>
                )}
              </>
            )}
            {fileError && (
              <p role="alert" className="text-xs text-critical">
                {fileError}
              </p>
            )}
          </div>
          <Field
            id="proposal-header"
            label={t('Header line')}
            hint={t('Printed under the logo, for example your address or tagline.')}
          >
            <Input
              id="proposal-header"
              disabled={!canManage}
              maxLength={300}
              value={header ?? settings.data.proposalHeader ?? ''}
              onChange={(e) => setHeader(e.target.value)}
            />
          </Field>
          <Field id="proposal-footer" label={t('Footer')}>
            <Input
              id="proposal-footer"
              disabled={!canManage}
              maxLength={500}
              value={footer ?? settings.data.proposalFooter ?? ''}
              onChange={(e) => setFooter(e.target.value)}
            />
          </Field>
          {canManage && (
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={
                save.isPending || (header === null && footer === null && logo === undefined)
              }
            >
              {t('Save branding')}
            </Button>
          )}
          <ErrorText error={save.error} />
        </form>
      </CardContent>
    </Card>
  );
}
