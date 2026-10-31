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

export function QuotesWorkspace() {
  const [tab, setTab] = useState<'quotes' | 'catalogue'>('quotes');
  return (
    <>
      <Tabs
        label="Quotes sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'quotes', label: 'Quotes' },
          { key: 'catalogue', label: 'Catalogue & pricing' },
        ]}
      />
      {tab === 'quotes' ? <QuoteList /> : <Catalogue />}
    </>
  );
}

function QuoteList() {
  const [status, setStatus] = useState('');
  const quotes = useQuotes({ status: status || undefined });
  const canWrite = useCan('quotes:write');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="quote-status" label="Status">
          <Select
            id="quote-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-48"
          >
            <option value="">All statuses</option>
            {Object.entries(QUOTE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
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
              No quotes yet. Start one from a deal.
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
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border text-left text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2 font-medium">Quote</th>
          {showDeal && <th className="px-4 py-2 font-medium">Deal</th>}
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 text-right font-medium">Total</th>
          <th className="px-4 py-2 font-medium">Valid until</th>
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
              <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>
              {q.expired && (
                <Badge tone="warning" className="ml-1">
                  Past valid date
                </Badge>
              )}
            </td>
            <td className="px-4 py-2 text-right tabular-nums">
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
        <Field id="new-quote-deal" label="Deal" className="w-72">
          <RecordPicker
            id="new-quote-deal"
            entity="deals"
            value={deal}
            onChange={setDeal}
            placeholder="Search deals"
          />
        </Field>
      )}
      <Button type="submit" size="sm" disabled={!deal || create.isPending}>
        <Plus aria-hidden /> New quote
      </Button>
      <div className="w-full">
        <ErrorText error={create.error} />
      </div>
    </form>
  );
}

function Catalogue() {
  const canManage = useCan('catalog:manage');
  const products = useProducts();
  const books = usePriceBooks();
  return (
    <div className="space-y-4">
      {!canManage && (
        <p className="text-sm text-muted-foreground">
          You can view the catalogue. Changing products, prices and tax rates needs the
          catalog:manage permission.
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
        <CardTitle className="text-base">Products and prices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-24" />
        ) : !products?.length ? (
          <p className="text-sm text-muted-foreground">No products yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Product</th>
                  {activeBooks.map((b) => (
                    <th key={b.id} className="pb-2 text-right font-medium">
                      {b.name} ({b.currency})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[p.sku, `per ${p.unit}`, !p.active && 'inactive']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    {activeBooks.map((b) => {
                      const price = p.prices.find((x) => x.priceBookId === b.id);
                      return (
                        <td key={b.id} className="py-2 text-right">
                          {canManage ? (
                            <PriceInput
                              label={`${p.name} price in ${b.name}`}
                              value={price?.unitPrice ?? null}
                              onSave={(unitPrice) =>
                                setPrice.mutate({ book: b.id, product: p.id, unitPrice })
                              }
                            />
                          ) : (
                            <span className="tabular-nums">
                              {price ? formatAmount(price.unitPrice, b.currency) : 'Not priced'}
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
            <Field id="product-name" label="New product">
              <Input
                id="product-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                className="w-56"
              />
            </Field>
            <Field id="product-sku" label="SKU (optional)">
              <Input
                id="product-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                maxLength={64}
                className="w-32"
              />
            </Field>
            <Button type="submit" size="sm" disabled={!name.trim() || add.isPending}>
              Add product
            </Button>
            <div className="w-full">
              <ErrorText error={add.error} />
            </div>
          </form>
        )}
        {canManage && (
          <p className="text-xs text-muted-foreground">
            Price changes are recorded in the audit log. Existing quotes keep their prices; a
            revision picks up the new price.
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
      placeholder="Not priced"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="ml-auto h-8 w-28 text-right tabular-nums"
    />
  );
}

function PriceBooks({ books, canManage }: { books?: PriceBookRow[]; canManage: boolean }) {
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
        <CardTitle className="text-base">Price books</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!books?.length ? (
          <p className="text-muted-foreground">
            No price books. Quotes need one in the deal&apos;s currency.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {books.map((b) => (
              <li key={b.id} className="flex items-center gap-2 py-2">
                <span className="font-medium">{b.name}</span>
                <Badge>{b.currency}</Badge>
                {b.isDefault && <Badge tone="primary">Default</Badge>}
                {!b.active && <Badge tone="warning">Inactive</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{b.entryCount} prices</span>
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
            <Field id="book-name" label="Name">
              <Input
                id="book-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-36"
                maxLength={120}
              />
            </Field>
            <Field id="book-currency" label="Currency">
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
              Add
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
        <CardTitle className="text-base">Tax rates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!rates.data?.length ? (
          <p className="text-muted-foreground">No tax rates. Lines without a rate carry no tax.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rates.data.map((r) => (
              <li key={r.id} className="flex py-2">
                <span>{r.name}</span>
                <span className="ml-auto tabular-nums">{r.rate}%</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          You set the rates; DealFlow does not look up or validate tax rules for any country.
        </p>
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && rate !== '') add.mutate();
            }}
          >
            <Field id="tax-name" label="Name">
              <Input
                id="tax-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-32"
                maxLength={80}
              />
            </Field>
            <Field id="tax-rate" label="Rate %">
              <Input
                id="tax-rate"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-20"
                inputMode="decimal"
              />
            </Field>
            <Button type="submit" size="sm" variant="outline" disabled={add.isPending}>
              Add
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
        <CardTitle className="text-base">Quote rules</CardTitle>
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
            label="Discount needing approval (above %)"
            hint="Any line discount above this needs someone with quotes:approve."
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
          <Field id="quote-validity" label="Quotes valid for (days)">
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
              Save rules
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
      return setFileError('Use a PNG or JPEG image.');
    if (file.size > 250_000) return setFileError('Use a logo under 250 KB.');
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proposal branding</CardTitle>
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
            <p className="text-sm font-medium">Logo</p>
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored data URL, not a remote image
              <img
                src={shownLogo}
                alt="Current proposal logo"
                className="h-12 max-w-48 object-contain"
              />
            ) : (
              <p className="text-xs text-muted-foreground">No logo yet.</p>
            )}
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Upload a logo"
                  type="file"
                  accept="image/png,image/jpeg"
                  className="text-xs"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
                {shownLogo && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLogo(null)}>
                    Remove logo
                  </Button>
                )}
              </div>
            )}
            {fileError && <p className="text-xs text-critical">{fileError}</p>}
          </div>
          <Field
            id="proposal-header"
            label="Header line"
            hint="Printed under the logo, for example your address or tagline."
          >
            <Input
              id="proposal-header"
              disabled={!canManage}
              maxLength={300}
              value={header ?? settings.data.proposalHeader ?? ''}
              onChange={(e) => setHeader(e.target.value)}
            />
          </Field>
          <Field id="proposal-footer" label="Footer">
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
              Save branding
            </Button>
          )}
          <ErrorText error={save.error} />
        </form>
      </CardContent>
    </Card>
  );
}
