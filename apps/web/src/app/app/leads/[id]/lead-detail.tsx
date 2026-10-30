'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { type DuplicateCandidate, type LeadConvertResult, type LeadRow, QUALIFICATION_FRAMEWORKS } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CustomFieldList, DetailError, DetailList, DetailSkeleton, RecordHeader } from '@/components/crm/record-detail';
import { Select } from '@/components/crm/select';
import { ActivityTimeline, RecordTasks } from '@/components/crm/timeline';
import { api } from '@/lib/api';
import { formatDate, formatMoney, LEAD_STATUS_TONE, titleCase, usePipelines, useRecord } from '@/lib/crm';
import { useCan } from '@/lib/session';

export function LeadDetail({ id }: { id: string }) {
  const lead = useRecord<LeadRow>('leads', id);
  const canWrite = useCan('leads:write');
  const canDeals = useCan('deals:write');
  const canContacts = useCan('contacts:write');
  const canCompanies = useCan('companies:write');
  const canConvert = canWrite && canDeals && canContacts && canCompanies;
  const [converting, setConverting] = useState(false);

  if (lead.isPending) return <DetailSkeleton />;
  if (lead.error) return <DetailError error={lead.error} />;
  const l = lead.data;
  const converted = l.status === 'CONVERTED';

  return (
    <div className="max-w-6xl">
      <RecordHeader
        entity="leads"
        id={id}
        title={l.fullName}
        subtitle={[l.jobTitle, l.companyName].filter(Boolean).join(' · ') || undefined}
        row={l as unknown as Record<string, unknown>}
        editable={!converted}
        badges={<Badge tone={LEAD_STATUS_TONE[l.status]}>{titleCase(l.status)}</Badge>}
        actions={
          !converted && canConvert ? (
            <Button size="sm" onClick={() => setConverting(true)} disabled={l.status === 'UNQUALIFIED'} title={l.status === 'UNQUALIFIED' ? 'Unqualified leads cannot be converted' : undefined}>
              <ArrowRightLeft aria-hidden /> Convert
            </Button>
          ) : null
        }
      />
      {converted && (
        <Card className="mb-4 border-success/40">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            Converted {formatDate(l.convertedAt)}. This lead is now read-only.
            {l.convertedContactId && <Link className="text-primary hover:underline" href={`/app/contacts/${l.convertedContactId}`}>Open contact</Link>}
            {l.convertedOpportunityId && <Link className="text-primary hover:underline" href={`/app/deals/${l.convertedOpportunityId}`}>Open deal</Link>}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {!converted && <Duplicates id={id} canWrite={canWrite} />}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ['Email', l.email && <a className="text-primary hover:underline" href={`mailto:${l.email}`}>{l.email}</a>],
                  ['Phone', l.phone],
                  ['Company', l.companyName],
                  ['Job title', l.jobTitle],
                  ['Industry', l.industry],
                  ['Location', [l.city, l.country].filter(Boolean).join(', ')],
                  ['Source', l.source],
                  ['Campaign', l.campaignSource],
                  ['Estimated value', l.estimatedValue !== null ? formatMoney(l.estimatedValue, l.currency ?? 'USD') : null],
                  ['Owner', l.owner?.name],
                  ['Tags', l.tags.length ? l.tags.map((t) => <Badge key={t} className="mr-1">{t}</Badge>) : null],
                  ['Created', formatDate(l.createdAt)],
                ]}
              />
            </CardContent>
          </Card>
          <ActivityTimeline related={{ leadId: id }} />
        </div>
        <div className="space-y-4">
          <Qualification lead={l} disabled={converted || !canWrite} />
          <RecordTasks related={{ leadId: id }} />
          <CustomFieldList entity="leads" values={l.customFields} />
        </div>
      </div>
      {converting && <ConvertDialog lead={l} onClose={() => setConverting(false)} />}
    </div>
  );
}

function Duplicates({ id, canWrite }: { id: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const dups = useQuery({ queryKey: ['leads', 'duplicates', id], queryFn: () => api<DuplicateCandidate[]>(`/leads/${id}/duplicates`) });
  const merge = useMutation({
    mutationFn: (duplicateId: string) => api<LeadRow>(`/leads/${id}/merge`, { method: 'POST', json: { duplicateId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['leads'] }),
  });
  if (!dups.data?.length) return null;
  const reason = { email: 'same email', phone: 'same phone number', name_company: 'same name and company' };
  return (
    <Card className="border-warning/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-warning" aria-hidden /> Possible duplicates
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {dups.data.map((d) => (
            <li key={`${d.entity}-${d.id}`} className="flex flex-wrap items-center gap-2 text-sm">
              <Link className="font-medium text-primary hover:underline" href={`/app/${d.entity === 'lead' ? 'leads' : 'contacts'}/${d.id}`}>
                {d.label}
              </Link>
              <Badge>{d.entity === 'lead' ? 'Lead' : 'Contact'}</Badge>
              <span className="text-muted-foreground">{reason[d.reason]}</span>
              {d.entity === 'lead' && canWrite && (
                <Button size="sm" variant="outline" className="ml-auto" disabled={merge.isPending} onClick={() => merge.mutate(d.id)}>
                  Merge into this lead
                </Button>
              )}
            </li>
          ))}
        </ul>
        {merge.error && (
          <p role="alert" className="mt-2 text-sm text-critical">
            {merge.error.message}
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Merging fills empty fields, combines tags, moves activities and tasks here, and removes the duplicate.</p>
      </CardContent>
    </Card>
  );
}

type Framework = keyof typeof QUALIFICATION_FRAMEWORKS;
const CRITERIA_LABEL: Record<string, string> = {
  budget: 'Budget', authority: 'Authority', need: 'Need', timeline: 'Timeline', metrics: 'Metrics', economicBuyer: 'Economic buyer',
  decisionCriteria: 'Decision criteria', decisionProcess: 'Decision process', identifyPain: 'Identified pain', champion: 'Champion', competition: 'Competition',
};

function Qualification({ lead, disabled }: { lead: LeadRow; disabled: boolean }) {
  const qc = useQueryClient();
  const saved = (lead.customFields.qualification ?? {}) as { framework?: Framework; met?: string[] };
  const [framework, setFramework] = useState<Framework>(saved.framework ?? 'BANT');
  // Local copy so checkboxes respond instantly; the server copy replaces it on save, or on error.
  const [local, setLocal] = useState<string[] | null>(null);
  const met = new Set(local ?? (saved.framework === framework ? (saved.met ?? []) : []));
  const save = useMutation({
    mutationFn: (next: string[]) => api<LeadRow>(`/leads/${lead.id}`, { method: 'PATCH', json: { customFields: { qualification: { framework, met: next } } } }),
    onMutate: (next) => setLocal(next),
    onSuccess: (row) => qc.setQueryData(['leads', 'detail', lead.id], row),
    onSettled: () => setLocal(null),
  });
  const criteria = QUALIFICATION_FRAMEWORKS[framework];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden /> Qualification
        </CardTitle>
        <label htmlFor="qual-framework" className="sr-only">
          Framework
        </label>
        <Select id="qual-framework" className="h-8 w-28 text-xs" value={framework} onChange={(e) => { setFramework(e.target.value as Framework); setLocal(null); }} disabled={disabled}>
          <option value="BANT">BANT</option>
          <option value="MEDDICC">MEDDICC</option>
        </Select>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
          {met.size} of {criteria.length} criteria confirmed
        </p>
        <ul className="space-y-1.5">
          {criteria.map((c) => (
            <li key={c}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[hsl(var(--primary))]"
                  checked={met.has(c)}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = new Set(met);
                    if (e.target.checked) next.add(c);
                    else next.delete(c);
                    save.mutate([...next]);
                  }}
                />
                {CRITERIA_LABEL[c] ?? c}
              </label>
            </li>
          ))}
        </ul>
        {save.error && (
          <p role="alert" className="mt-2 text-sm text-critical">
            {save.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ConvertDialog({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const pipelines = usePipelines();
  const [createDeal, setCreateDeal] = useState(true);
  const [dealName, setDealName] = useState(`${lead.companyName ?? lead.fullName} deal`);
  const [amount, setAmount] = useState(lead.estimatedValue !== null ? String(lead.estimatedValue) : '');
  const [pipelineId, setPipelineId] = useState('');
  const convert = useMutation({
    mutationFn: () =>
      api<LeadConvertResult>(`/leads/${lead.id}/convert`, {
        method: 'POST',
        json: { createDeal, ...(createDeal ? { dealName, dealAmount: amount ? Number(amount) : undefined, pipelineId: pipelineId || undefined } : {}) },
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      router.push(r.opportunityId ? `/app/deals/${r.opportunityId}` : `/app/contacts/${r.contactId}`);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="p-6">
        <DialogTitle className="text-lg font-semibold">Convert {lead.fullName}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Creates a contact{lead.companyName ? `, links or creates the company “${lead.companyName}”` : ''}, and optionally a deal. Activities and tasks move to the new records.
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            convert.mutate();
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} />
            Create a deal
          </label>
          {createDeal && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field id="convert-name" label="Deal name">
                  <Input value={dealName} onChange={(e) => setDealName(e.target.value)} maxLength={200} required />
                </Field>
              </div>
              <Field id="convert-amount" label="Amount">
                <Input type="number" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field id="convert-pipeline" label="Pipeline">
                <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                  <option value="">Default pipeline</option>
                  {pipelines.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {convert.error && (
            <p role="alert" className="text-sm text-critical">
              {convert.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={convert.isPending}>
              {convert.isPending ? 'Converting…' : 'Convert lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
