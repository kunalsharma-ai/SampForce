'use client';

import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Skeleton,
} from '@dealflow/ui';
import {
  BULK_PERMISSION,
  CONSOLE_BULK_ACTIONS,
  CONSOLE_CLIENT_PAGE_SIZES,
  type ConsoleBulkAction,
  type ConsoleClientCreated,
  type ConsoleClientPage,
  type ConsoleClientSort,
  type ConsolePlanRow,
  geoCountry,
  type OperatorOpenInvoice,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUSES,
  type PaymentStatus,
  PLAN_CATALOG,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Plus,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ClientAvatar } from '@/components/console/client-avatar';
import { BULK_TITLE, BulkDialog } from '@/components/console/client-bulk';
import { CountrySelect } from '@/components/forms/inputs';
import { CountryFlag } from '@/components/crm/status-chip';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api, downloadFile } from '@/lib/api';
import { formatDate, formatMinor } from '@/lib/billing';
import { PaymentBadge, price, selectClass, StateBadge, toCents, toLimit } from '../console-ui';
import { can, useOperator } from '../operator-shell';

const FILTERS = [
  'search',
  'state',
  'plan',
  'billing',
  'country',
  'payment',
  'createdFrom',
  'createdTo',
] as const;
type Filter = (typeof FILTERS)[number];

const COLUMNS: { key: ConsoleClientSort; label: string; end?: boolean }[] = [
  { key: 'name', label: 'Client' },
  { key: 'country', label: 'Country' },
  { key: 'plan', label: 'Plan' },
  { key: 'payment', label: 'Payment' },
  { key: 'renews', label: 'Renews' },
  { key: 'managers', label: 'Managers', end: true },
  { key: 'executives', label: 'Executives', end: true },
  { key: 'people', label: 'People', end: true },
  { key: 'created', label: 'Created' },
];

/** Used / allowed with a thin bar; no bar without a limit. */
function Allocation({ used, max }: { used: number; max: number | null | undefined }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="ms-auto w-20">
      <div className="tabular">{max === undefined ? used : `${used} / ${max ?? '∞'}`}</div>
      {max ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={`h-full rounded-full ${used > max ? 'bg-critical' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Client organisations (ADR 0071; list redesigned in ADR 0074, C4b): filters that combine and stay in the address, so
 * a filtered list can be bookmarked or shared; sort on every column; pages of 25, 50 or 100; CSV of what the filters
 * show; and bulk actions over the selected clients.
 */
export default function ConsoleClientsPage() {
  // The filters live in the address (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ClientsList />
    </Suspense>
  );
}

function ClientsList() {
  const me = useOperator();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<ConsoleBulkAction | null>(null);
  const [exporting, setExporting] = useState(false);
  const f = (k: Filter) => params.get(k) ?? '';
  const sort = (params.get('sort') as ConsoleClientSort | null) ?? 'created';
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const perPage = Number(params.get('perPage')) || 25;
  const pageNo = Number(params.get('page')) || 1;
  const [search, setSearch] = useState(f('search'));

  const setParams = (next: Record<string, string | number | null>, keepPage = false) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    if (!keepPage) p.delete('page');
    // The address changes without a navigation (Next keeps useSearchParams in step), so a late, debounced search can
    // never pull the operator back here after they opened a client.
    if (window.location.pathname !== '/operator/clients') return;
    window.history.replaceState(null, '', `/operator/clients${p.size ? `?${p}` : ''}`);
  };
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== f('search')) setParams({ search: search.trim() });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed search starts this
  }, [search]);

  const query = new URLSearchParams();
  for (const k of FILTERS) if (f(k)) query.set(k, f(k));
  query.set('sort', sort);
  query.set('dir', dir);
  const list = useQuery({
    enabled: !!me.data,
    queryKey: ['operator', 'clients', 'page', query.toString(), pageNo, perPage],
    queryFn: () =>
      api<ConsoleClientPage>(`/operator/clients/page?${query}&page=${pageNo}&perPage=${perPage}`),
    placeholderData: (prev) => prev,
  });
  const plans = useQuery({
    enabled: !!me.data,
    queryKey: ['operator', 'console-plans'],
    queryFn: () => api<ConsolePlanRow[]>('/operator/console-plans'),
  });
  if (!me.data) return <Skeleton className="h-64" />;
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const shownPage = list.data?.page ?? pageNo;
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((cur) => {
      const n = new Set(cur);
      for (const r of rows) {
        if (allOnPage) n.delete(r.id);
        else n.add(r.id);
      }
      return n;
    });
  const bulkActions = CONSOLE_BULK_ACTIONS.filter((a) => can(me.data, BULK_PERMISSION[a]));
  const activeFilters = FILTERS.filter((k) => k !== 'search' && f(k)).length;
  const sortBy = (key: ConsoleClientSort) =>
    setParams({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' });

  return (
    <>
      <PageHeader
        title="Clients"
        description="Client organisations, their plans, terms and workspace usage. CRM records are never shown here."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadFile(`/operator/clients/export?${query}`, 'sampforce-clients.csv');
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download className="size-4" aria-hidden />
              Export CSV
            </Button>
            {can(me.data, 'clients.edit') && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                New client
              </Button>
            )}
          </div>
        }
      />
      <AwaitingPayment />
      <div
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter clients"
        data-client-filters
      >
        <div className="min-w-56 flex-1 sm:flex-none">
          <label htmlFor="op-search" className="mb-1 block text-xs text-muted-foreground">
            Search clients
          </label>
          <Input
            id="op-search"
            placeholder="Name, customer ID or admin email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:w-72"
          />
        </div>
        <FilterSelect
          id="op-state"
          label="Status"
          value={f('state')}
          onChange={(v) => setParams({ state: v })}
          options={[
            ['ACTIVE', 'Active'],
            ['SUSPENDED', 'Suspended'],
            ['DEACTIVATED', 'Deactivated'],
          ]}
        />
        <FilterSelect
          id="op-plan"
          label="Plan"
          value={f('plan')}
          onChange={(v) => setParams({ plan: v })}
          options={(plans.data ?? []).map((p) => [p.code, p.name.replace('SampForce ', '')])}
        />
        <FilterSelect
          id="op-billing"
          label="Billing"
          value={f('billing')}
          onChange={(v) => setParams({ billing: v })}
          options={[
            ['MONTH', 'Monthly'],
            ['YEAR', 'Yearly'],
          ]}
        />
        <FilterSelect
          id="op-payment"
          label="Payment"
          value={f('payment')}
          onChange={(v) => setParams({ payment: v })}
          options={[
            ...PAYMENT_STATUSES.map((p) => [p, PAYMENT_STATUS_LABEL[p]] as [string, string]),
            ['NONE', 'No payment status'],
          ]}
        />
        <div className="w-48">
          <label htmlFor="op-country" className="mb-1 block text-xs text-muted-foreground">
            Country
          </label>
          <CountrySelect
            id="op-country"
            value={f('country')}
            onChange={(code) => setParams({ country: code })}
          />
        </div>
        <div>
          <label htmlFor="op-from" className="mb-1 block text-xs text-muted-foreground">
            Created from
          </label>
          <Input
            id="op-from"
            type="date"
            value={f('createdFrom')}
            max={f('createdTo') || undefined}
            onChange={(e) => setParams({ createdFrom: e.target.value })}
            className="w-40"
          />
        </div>
        <div>
          <label htmlFor="op-to" className="mb-1 block text-xs text-muted-foreground">
            Created to
          </label>
          <Input
            id="op-to"
            type="date"
            value={f('createdTo')}
            min={f('createdFrom') || undefined}
            onChange={(e) => setParams({ createdTo: e.target.value })}
            className="w-40"
          />
        </div>
        {(activeFilters > 0 || f('search')) && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              setParams(Object.fromEntries(FILTERS.map((k) => [k, null])));
            }}
          >
            <X className="size-4" aria-hidden /> Clear filters
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <div
          className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-surface p-2 shadow-sm"
          role="region"
          aria-label="Bulk actions"
          data-bulk-bar
        >
          <span className="px-2 text-sm font-medium" aria-live="polite">
            {selected.size} selected
          </span>
          {bulkActions.map((a) => (
            <Button key={a} size="sm" variant="outline" onClick={() => setBulk(a)}>
              {BULK_TITLE[a]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <ErrorText error={list.error} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm" data-console-clients="">
          <caption className="sr-only">
            Clients, sorted by {COLUMNS.find((c) => c.key === sort)?.label ?? sort}
          </caption>
          <thead className="text-start text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 p-3">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={allOnPage}
                  onChange={toggleAll}
                  aria-label="Select every client on this page"
                />
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`p-3 font-medium ${c.end ? 'text-end' : 'text-start'}`}
                  aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(c.key)}
                    className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.label}
                    {sort === c.key ? (
                      dir === 'asc' ? (
                        <ArrowUp className="size-3" aria-hidden />
                      ) : (
                        <ArrowDown className="size-3" aria-hidden />
                      )
                    ) : (
                      <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = c.subscription;
              return (
                <tr
                  key={c.id}
                  className={`border-t border-border ${selected.has(c.id) ? 'bg-primary/5' : ''}`}
                  data-client-row={c.id}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`Select ${c.name}`}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <ClientAvatar name={c.name} logoUrl={c.logoUrl} size="sm" />
                      <div className="min-w-0">
                        <Link
                          href={`/operator/clients/${c.id}`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="ms-2">
                          <StateBadge state={c.state} />
                        </span>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          {c.customerId && (
                            <span className="whitespace-nowrap font-mono tabular" data-customer-id>
                              {c.customerId}
                            </span>
                          )}
                          {c.awaitingAdministrator && (
                            <span className="whitespace-nowrap">administrator not joined</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    {c.countryCode ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CountryFlag code={c.countryCode} />
                        <span>
                          {geoCountry(c.countryCode)?.name ?? c.countryCode}
                          {c.city && (
                            <span className="block text-xs text-muted-foreground">{c.city}</span>
                          )}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {s ? (
                      <>
                        {s.planName.replace('SampForce ', '')}
                        <span className="block text-xs text-muted-foreground">
                          {price(s.priceCents, s.currency, s.billingFrequency)}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3">
                    <PaymentBadge status={s?.paymentStatus ?? null} />
                  </td>
                  <td className="p-3 tabular">{s?.renewsOn ? formatDate(s.renewsOn) : '—'}</td>
                  <td className="p-3 text-end">
                    <Allocation used={c.usage.managers} max={s ? s.limits.managers : undefined} />
                  </td>
                  <td className="p-3 text-end">
                    <Allocation
                      used={c.usage.executives}
                      max={s ? s.limits.executives : undefined}
                    />
                  </td>
                  <td className="p-3 text-end tabular">{c.people}</td>
                  <td className="p-3 tabular">{formatDate(c.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.isPending && <Skeleton className="m-3 h-24" />}
        {list.data && rows.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No clients match.</p>
        )}
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm"
          data-client-paging
        >
          <span className="text-muted-foreground" aria-live="polite">
            {total === 0
              ? 'No clients'
              : `${(shownPage - 1) * perPage + 1}–${Math.min(shownPage * perPage, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <label htmlFor="op-per-page" className="whitespace-nowrap text-muted-foreground">
              Per page
            </label>
            <div className="w-20">
              <select
                id="op-per-page"
                className={selectClass}
                value={perPage}
                onChange={(e) =>
                  setParams({ perPage: e.target.value === '25' ? null : e.target.value })
                }
              >
                {CONSOLE_CLIENT_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={shownPage <= 1}
              onClick={() => setParams({ page: shownPage - 1 }, true)}
            >
              <ChevronLeft className="size-4" aria-hidden /> Previous
            </Button>
            <span className="whitespace-nowrap tabular">
              Page {shownPage} of {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={shownPage >= pages}
              onClick={() => setParams({ page: shownPage + 1 }, true)}
            >
              Next <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </Card>
      {creating && <NewClientDialog onClose={() => setCreating(false)} />}
      {bulk && (
        <BulkDialog
          action={bulk}
          ids={[...selected]}
          onClose={(changed) => {
            setBulk(null);
            if (changed) setSelected(new Set());
          }}
        />
      )}
    </>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        className={`${selectClass} w-40`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Offline invoices clients have requested and not yet paid. Payments are recorded on the client's billing page. */
function AwaitingPayment() {
  const open = useQuery({
    queryKey: ['operator', 'invoices', 'open'],
    queryFn: () => api<OperatorOpenInvoice[]>('/operator/invoices/open'),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  if (!open.data?.length) return <ErrorText error={open.error} />;
  return (
    <Card className="mb-6 p-4">
      <h2 className="text-sm font-medium">Waiting for payment ({open.data.length})</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {open.data.map((i) => (
          <li key={i.id} className="flex flex-wrap gap-x-3">
            <Link
              href={`/operator/tenants/${i.tenant.id}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {i.tenant.name}
            </Link>
            <span>{i.number}</span>
            <span className="text-muted-foreground">
              {PLAN_CATALOG.find((p) => p.code === i.planCode)?.name ?? i.planCode} · {i.seats}{' '}
              seats · {i.interval === 'YEAR' ? 'annual' : 'monthly'} · issued{' '}
              {formatDate(i.issuedAt)}
            </span>
            <span className="tabular">{formatMinor(i.totalCents, i.currency)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NewClientDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const plans = useQuery({
    queryKey: ['operator', 'console-plans'],
    queryFn: () => api<ConsolePlanRow[]>('/operator/console-plans'),
  });
  const offered = (plans.data ?? []).filter((p) => p.terms.available);
  const [f, setF] = useState({
    org: '',
    adminName: '',
    adminEmail: '',
    designation: 'Client Administrator',
    planCode: '',
    seats: '10',
    startsOn: new Date().toISOString().slice(0, 10),
    months: '',
    price: '',
    currency: '',
    paymentStatus: 'PENDING' as PaymentStatus,
    managers: '',
    executives: '',
    superExecutives: true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  const plan = offered.find((p) => p.code === f.planCode) ?? offered[0];
  const [created, setCreated] = useState<ConsoleClientCreated | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<ConsoleClientCreated>('/operator/clients', {
        method: 'POST',
        json: {
          organisation: { name: f.org },
          administrator: {
            name: f.adminName,
            email: f.adminEmail,
            ...(f.designation.trim() ? { designation: f.designation } : {}),
          },
          planCode: plan?.code ?? '',
          seats: Number(f.seats) || 1,
          startsOn: f.startsOn,
          ...(f.months ? { durationMonths: Number(f.months) } : {}),
          ...(f.price.trim() ? { priceCents: toCents(f.price) } : {}),
          ...(f.currency.trim() ? { currency: f.currency } : {}),
          paymentStatus: f.paymentStatus,
          ...(f.managers.trim() ? { maxManagerWorkspaces: toLimit(f.managers) } : {}),
          ...(f.executives.trim() ? { maxExecutiveWorkspaces: toLimit(f.executives) } : {}),
          superCanCreateExecutives: f.superExecutives,
          reason: 'New client',
        },
      }),
    onSuccess: (r) => {
      setCreated(r);
      void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      void qc.invalidateQueries({ queryKey: ['operator', 'overview'] });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">
          {created ? 'Client created' : 'New client organisation'}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {created
            ? 'Send this link to the administrator. It works once and for seven days; you can send a new one from the client’s page.'
            : 'Creates the organisation, its Super Workspace and subscription, and an invitation for the administrator, who joins as the Super Workspace’s owner.'}
        </DialogDescription>
        {created ? (
          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={created.inviteUrl}
                aria-label="Administrator invitation link"
              />
              <Button
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(created.inviteUrl)}
              >
                <Copy className="size-4" aria-hidden />
                Copy
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => router.push(`/operator/clients/${created.client.id}`)}>
                Open client
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">Organisation and administrator</legend>
              <Field id="nc-org" label="Organisation name" className="sm:col-span-2">
                <Input id="nc-org" required minLength={2} value={f.org} onChange={set('org')} />
              </Field>
              <Field id="nc-admin" label="Administrator’s name">
                <Input id="nc-admin" required value={f.adminName} onChange={set('adminName')} />
              </Field>
              <Field id="nc-email" label="Administrator’s email">
                <Input
                  id="nc-email"
                  type="email"
                  required
                  value={f.adminEmail}
                  onChange={set('adminEmail')}
                />
              </Field>
              <Field
                id="nc-designation"
                label="Administrator’s designation"
                hint="Shown in their profile. It grants nothing by itself."
                className="sm:col-span-2"
              >
                <Input id="nc-designation" value={f.designation} onChange={set('designation')} />
              </Field>
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold">Subscription</legend>
              <Field id="nc-plan" label="Plan" className="sm:col-span-2">
                <select
                  id="nc-plan"
                  className={selectClass}
                  value={plan?.code ?? ''}
                  onChange={set('planCode')}
                >
                  {offered.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name.replace('SampForce ', '')} · {p.features.length} features ·{' '}
                      {price(p.terms.priceCents, p.terms.currency, p.terms.billingFrequency)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="nc-seats" label="Seats">
                <Input
                  id="nc-seats"
                  type="number"
                  min={1}
                  required
                  value={f.seats}
                  onChange={set('seats')}
                />
              </Field>
              <Field id="nc-start" label="Starts on">
                <Input
                  id="nc-start"
                  type="date"
                  required
                  value={f.startsOn}
                  onChange={set('startsOn')}
                />
              </Field>
              <Field
                id="nc-months"
                label="Term in months"
                hint={plan ? `Plan: ${plan.terms.durationMonths}` : undefined}
              >
                <Input
                  id="nc-months"
                  type="number"
                  min={1}
                  max={120}
                  value={f.months}
                  onChange={set('months')}
                  placeholder={plan ? String(plan.terms.durationMonths) : ''}
                />
              </Field>
              <Field id="nc-payment" label="Payment">
                <select
                  id="nc-payment"
                  className={selectClass}
                  value={f.paymentStatus}
                  onChange={set('paymentStatus')}
                >
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PAYMENT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="nc-price"
                label="Agreed price per period"
                hint={
                  plan ? `Plan: ${price(plan.terms.priceCents, plan.terms.currency)}` : undefined
                }
              >
                <Input
                  id="nc-price"
                  inputMode="decimal"
                  value={f.price}
                  onChange={set('price')}
                  placeholder="Plan price"
                />
              </Field>
              <Field id="nc-currency" label="Currency">
                <Input
                  id="nc-currency"
                  maxLength={3}
                  value={f.currency}
                  onChange={set('currency')}
                  placeholder={plan?.terms.currency ?? 'USD'}
                />
              </Field>
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">Workspace limits and authority</legend>
              <Field
                id="nc-managers"
                label="Manager Workspaces"
                hint={`Empty: the plan’s limit (${plan?.limits.maxManagerWorkspaces ?? 'none'})`}
              >
                <Input
                  id="nc-managers"
                  type="number"
                  min={0}
                  value={f.managers}
                  onChange={set('managers')}
                />
              </Field>
              <Field
                id="nc-executives"
                label="Executive Workspaces"
                hint={`Empty: the plan’s limit (${plan?.limits.maxExecutiveWorkspaces ?? 'none'})`}
              >
                <Input
                  id="nc-executives"
                  type="number"
                  min={0}
                  value={f.executives}
                  onChange={set('executives')}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={f.superExecutives}
                  onChange={(e) => setF({ ...f, superExecutives: e.target.checked })}
                />
                The Super Workspace may create Executive Workspaces itself
              </label>
            </fieldset>
            <ErrorText error={create.error ?? plans.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !plan}>
                Create client
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
