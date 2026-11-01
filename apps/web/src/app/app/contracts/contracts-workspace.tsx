'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { ContractRow } from '@dealflow/types';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RecordPicker, type PickerValue } from '@/components/crm/record-picker';
import { Select } from '@/components/crm/select';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { CONTRACT_STATUS, formatAmount, todayIso, useContracts } from '@/lib/revenue';
import { useCan } from '@/lib/session';

export function ContractsWorkspace() {
  const [tab, setTab] = useState<'all' | 'renewals'>('all');
  const [status, setStatus] = useState('');
  const canWrite = useCan('contracts:write');
  const contracts = useContracts(tab === 'renewals' ? { renewalWithinDays: 90 } : { status: status || undefined });
  return (
    <div className="space-y-4">
      <Tabs label="Contract views" value={tab} onChange={setTab} tabs={[{ key: 'all', label: 'All contracts' }, { key: 'renewals', label: 'Renewals in the next 90 days' }]} />
      {tab === 'all' && (
        <Field id="contract-status" label="Status">
          <Select id="contract-status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">All statuses</option>
            {Object.entries(CONTRACT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {canWrite && tab === 'all' && <NewContract />}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {contracts.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : contracts.error ? (
            <div className="p-4">
              <ErrorText error={contracts.error} />
            </div>
          ) : contracts.data.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{tab === 'renewals' ? 'No active contracts end in the next 90 days.' : 'No contracts yet. Create one here or from an accepted quote.'}</p>
          ) : (
            <ContractTable rows={contracts.data} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ContractTable({ rows, showCompany = true }: { rows: ContractRow[]; showCompany?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border text-start text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2 font-medium">Contract</th>
          {showCompany && <th className="px-4 py-2 font-medium">Company</th>}
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 text-end font-medium">Value</th>
          <th className="px-4 py-2 font-medium">Term</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-2">
              <Link href={`/app/contracts/${c.id}`} className="font-medium text-primary hover:underline">
                {c.reference}
              </Link>
              <span className="block text-xs text-muted-foreground">{c.name}</span>
            </td>
            {showCompany && (
              <td className="px-4 py-2">
                {c.company ? (
                  <Link href={`/app/companies/${c.company.id}`} className="hover:underline">
                    {c.company.name}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            )}
            <td className="px-4 py-2">
              <Badge tone={CONTRACT_STATUS[c.status].tone}>{CONTRACT_STATUS[c.status].label}</Badge>
              {c.renewalDue && (
                <Badge tone="warning" className="ms-1">
                  Renewal due
                </Badge>
              )}
              {c.renewalId && c.status === 'ACTIVE' && (
                <Badge tone="primary" className="ms-1">
                  Renewal started
                </Badge>
              )}
            </td>
            <td className="px-4 py-2 text-end tabular-nums">{formatAmount(c.value, c.currency)}</td>
            <td className="px-4 py-2">
              {formatDate(c.startDate)} to {c.endDate ? formatDate(c.endDate) : 'open-ended'}
              {c.daysToEnd !== null && c.status === 'ACTIVE' && <span className="block text-xs text-muted-foreground">{c.daysToEnd >= 0 ? `${c.daysToEnd} days left` : `ended ${-c.daysToEnd} days ago`}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NewContract() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState<PickerValue | null>(null);
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('');
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState('');
  const [notice, setNotice] = useState('30');
  const [autoRenew, setAutoRenew] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      api<ContractRow>('/contracts', {
        method: 'POST',
        json: { name, companyId: company?.id ?? null, value: Number(value || 0), currency: currency || undefined, startDate: start, endDate: end || null, renewalNoticeDays: Number(notice), autoRenew },
      }),
    onSuccess: (c) => router.push(`/app/contracts/${c.id}`),
  });
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New contract
      </Button>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New contract</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field id="c-name" label="Name">
            <Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <Field id="c-company" label="Company">
            <RecordPicker id="c-company" entity="companies" value={company} onChange={setCompany} placeholder="Search companies" />
          </Field>
          <div className="flex gap-2">
            <Field id="c-value" label="Value" className="flex-1">
              <Input id="c-value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
            </Field>
            <Field id="c-currency" label="Currency" className="w-24">
              <Input id="c-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="Default" className="uppercase" />
            </Field>
          </div>
          <Field id="c-start" label="Start date">
            <Input id="c-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field id="c-end" label="End date" hint="Leave empty for an open-ended contract.">
            <Input id="c-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field id="c-notice" label="Remind this many days before the end">
            <Input id="c-notice" value={notice} onChange={(e) => setNotice(e.target.value)} inputMode="numeric" />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> Marked to auto-renew (a reminder still asks you to start the renewal)
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={create.isPending}>
              Create draft
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <div className="sm:col-span-3">
            <ErrorText error={create.error} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
