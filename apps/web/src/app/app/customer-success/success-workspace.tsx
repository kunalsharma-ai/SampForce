'use client';

import { Badge, Button, Card, CardContent, Input, Skeleton } from '@dealflow/ui';
import type { CustomerRow, EscalationRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { RecordPicker, type PickerValue } from '@/components/crm/record-picker';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { formatAmount, HEALTH_BAND, SEVERITY_TONE, useCustomers, useEscalations } from '@/lib/revenue';
import { useCan } from '@/lib/session';

export function SuccessWorkspace() {
  const [tab, setTab] = useState<'customers' | 'escalations'>('customers');
  return (
    <>
      <Tabs label="Customer success sections" value={tab} onChange={setTab} tabs={[{ key: 'customers', label: 'Customers' }, { key: 'escalations', label: 'Escalations' }]} />
      {tab === 'customers' ? <Customers /> : <Escalations />}
    </>
  );
}

function Customers() {
  const customers = useCustomers();
  const focus = useSearchParams().get('company');
  if (customers.isPending) return <Skeleton className="h-48" />;
  if (customers.error) return <ErrorText error={customers.error} />;
  if (customers.data.length === 0)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No customers yet. A company becomes a customer when it has an active contract.{' '}
          <Link href="/app/contracts" className="text-primary hover:underline">
            Go to contracts
          </Link>
        </CardContent>
      </Card>
    );
  const counts = { healthy: 0, watch: 0, at_risk: 0 };
  for (const c of customers.data) counts[c.health.band]++;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(counts) as (keyof typeof counts)[]).map((b) => (
          <Card key={b}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{HEALTH_BAND[b].label}</p>
              <p className="text-xl font-semibold tabular-nums">{counts[b]}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <ul className="space-y-3">
        {customers.data.map((c) => (
          <CustomerCard key={c.company.id} c={c} highlight={c.company.id === focus} />
        ))}
      </ul>
    </div>
  );
}

export function CustomerCard({ c, highlight }: { c: CustomerRow; highlight?: boolean }) {
  return (
    <li>
      <Card className={highlight ? 'ring-2 ring-primary' : undefined}>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/app/companies/${c.company.id}`} className="font-semibold text-primary hover:underline">
              {c.company.name}
            </Link>
            <Badge tone={HEALTH_BAND[c.health.band].tone}>
              {HEALTH_BAND[c.health.band].label} · {c.health.score}/100
            </Badge>
            {c.openEscalations > 0 && <Badge tone="warning">{c.openEscalations} open escalation{c.openEscalations === 1 ? '' : 's'}</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">{c.owner?.name ?? 'Unassigned'}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {c.activeContracts} active contract{c.activeContracts === 1 ? '' : 's'} · {formatAmount(c.contractValue, c.currency)}
            {c.nextRenewal && (
              <>
                {' '}
                · next end{' '}
                <Link href={`/app/contracts/${c.nextRenewal.contractId}`} className="text-primary hover:underline">
                  {c.nextRenewal.reference}
                </Link>{' '}
                on {formatDate(c.nextRenewal.endDate)} ({c.nextRenewal.daysToEnd} days)
              </>
            )}
          </p>
          {c.health.signals.length > 0 ? (
            <ul className="space-y-0.5 text-xs">
              {c.health.signals.map((s, i) => (
                <li key={`${s.key}-${i}`}>
                  <span className="font-medium">−{s.points}</span> {s.label}: <span className="text-muted-foreground">{s.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-success">No risk signals.</p>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

function Escalations() {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | ''>('OPEN');
  const list = useEscalations({ status: status || undefined });
  const canWrite = useCan('success:write');
  return (
    <div className="space-y-4">
      <Field id="esc-status" label="Status">
        <Select id="esc-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-40">
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="">All</option>
        </Select>
      </Field>
      {canWrite && <NewEscalation />}
      {list.isPending ? (
        <Skeleton className="h-24" />
      ) : !list.data?.length ? (
        <p className="text-sm text-muted-foreground">No escalations.</p>
      ) : (
        <ul className="space-y-3">
          {list.data.map((e) => (
            <EscalationCard key={e.id} e={e} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function EscalationCard({ e, canWrite }: { e: EscalationRow; canWrite: boolean }) {
  const qc = useQueryClient();
  const [resolution, setResolution] = useState('');
  const resolve = useMutation({
    mutationFn: () => api(`/success/escalations/${e.id}/resolve`, { method: 'POST', json: { resolution } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['success'] }),
  });
  return (
    <li>
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{e.title}</span>
            <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity.toLowerCase()}</Badge>
            <Badge tone={e.status === 'OPEN' ? 'warning' : 'success'}>{e.status === 'OPEN' ? 'Open' : 'Resolved'}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              <Link href={`/app/companies/${e.company.id}`} className="hover:underline">
                {e.company.name}
              </Link>{' '}
              · {e.owner?.name ?? 'Unassigned'} · {relativeTime(e.createdAt)}
            </span>
          </div>
          {e.description && <p className="whitespace-pre-wrap text-muted-foreground">{e.description}</p>}
          {e.resolution && (
            <p>
              <span className="font-medium">Resolution:</span> {e.resolution}
            </p>
          )}
          {e.status === 'OPEN' && canWrite && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (resolution.trim()) resolve.mutate();
              }}
            >
              <label htmlFor={`res-${e.id}`} className="sr-only">
                Resolution
              </label>
              <Input id={`res-${e.id}`} value={resolution} onChange={(ev) => setResolution(ev.target.value)} placeholder="What fixed it?" className="h-9 min-w-56 flex-1" maxLength={5000} />
              <Button type="submit" size="sm" variant="outline" disabled={!resolution.trim() || resolve.isPending}>
                Resolve
              </Button>
            </form>
          )}
          <ErrorText error={resolve.error} />
        </CardContent>
      </Card>
    </li>
  );
}

export function NewEscalation({ company: fixed }: { company?: PickerValue }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState<PickerValue | null>(fixed ?? null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('MEDIUM');
  const create = useMutation({
    mutationFn: () => api('/success/escalations', { method: 'POST', json: { companyId: company!.id, title, description: description || null, severity } }),
    onSuccess: async () => {
      setOpen(false);
      setTitle('');
      setDescription('');
      await qc.invalidateQueries({ queryKey: ['success'] });
    },
  });
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Open escalation
      </Button>
    );
  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (company && title.trim()) create.mutate();
      }}
    >
      {!fixed && (
        <Field id="esc-company" label="Company">
          <RecordPicker id="esc-company" entity="companies" value={company} onChange={setCompany} placeholder="Search companies" />
        </Field>
      )}
      <Field id="esc-title" label="Title">
        <Input id="esc-title" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field id="esc-severity" label="Severity">
        <Select id="esc-severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </Select>
      </Field>
      <Field id="esc-desc" label="Details (optional)" className="sm:col-span-3">
        <Textarea id="esc-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={!company || !title.trim() || create.isPending}>
          Open escalation
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <div className="sm:col-span-3">
        <ErrorText error={create.error} />
      </div>
    </form>
  );
}
