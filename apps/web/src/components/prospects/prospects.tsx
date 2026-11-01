'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
  COMPANY_SIZES,
  EMAIL_STATUS_LABELS,
  type EmailStatus,
  type Facet,
  PROSPECT_IMPORT_FIELD_LABELS,
  PROSPECT_IMPORT_FIELDS,
  PROSPECT_SOURCE_LABELS,
  type ProspectImportField,
  type ProspectImportPreview,
  type ProspectListRow,
  type ProspectRow,
  type ProspectSource,
  type ProviderMode,
  type ProviderPerson,
  type ProviderSearchResult,
} from '@dealflow/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { useMembers } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { addResultText, type ProspectFilters, prospectsApi, useListPerformance, useProspectList, useProspectLists, useProspectMutation, useProspectSettings, useProspectUsage } from '@/lib/prospects';
import { useSequences } from '@/lib/sequences';
import { useCan } from '@/lib/session';

const MODE_TONE: Record<ProviderMode, 'warning' | 'success' | 'neutral'> = { mock: 'warning', pending: 'neutral', live: 'success' };
const MODE_LABEL: Record<ProviderMode, string> = { mock: 'Mock Mode', pending: 'Pending Configuration', live: 'Connected' };

function Alert({ error }: { error: Error | null | undefined }) {
  return error ? <p role="alert" className="text-sm text-critical">{error.message}</p> : null;
}

function Status({ children }: { children: React.ReactNode }) {
  return <p role="status" className="text-sm text-success">{children}</p>;
}

function ProviderBanner() {
  const s = useProspectSettings();
  if (!s.data) return null;
  const { apollo, hunter } = s.data.providers;
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="font-medium">Apollo.io people search <Badge tone={MODE_TONE[apollo.mode]}>{MODE_LABEL[apollo.mode]}</Badge></p>
          <p className="mt-1 text-muted-foreground">{apollo.detail}</p>
        </div>
        <div>
          <p className="font-medium">Hunter.io email verification <Badge tone={MODE_TONE[hunter.mode]}>{MODE_LABEL[hunter.mode]}</Badge></p>
          <p className="mt-1 text-muted-foreground">{hunter.detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ───── Index: lists and limits ─────

export function ProspectListsWorkspace() {
  const [tab, setTab] = useState<'lists' | 'limits'>('lists');
  return (
    <div className="space-y-4">
      <ProviderBanner />
      <div role="tablist" aria-label="Prospect lists" className="flex gap-1 border-b border-border">
        {(
          [
            ['lists', 'Lists'],
            ['limits', 'Usage and limits'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" id={`pl-tab-${k}`} aria-selected={tab === k} aria-controls={`pl-panel-${k}`} onClick={() => setTab(k)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`pl-panel-${tab}`} aria-labelledby={`pl-tab-${tab}`}>
        {tab === 'lists' ? <Lists /> : <Limits />}
      </div>
    </div>
  );
}

function Lists() {
  const q = useProspectLists();
  const canWrite = useCan('prospects:write');
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      {canWrite && (creating ? <ListForm onDone={() => setCreating(false)} /> : <Button onClick={() => setCreating(true)}>New list</Button>)}
      <Card>
        <CardContent className="overflow-x-auto p-4">
          {q.isPending ? (
            <Skeleton className="h-32" />
          ) : q.error ? (
            <Alert error={q.error} />
          ) : !q.data.length ? (
            <p className="text-sm text-muted-foreground">No prospect lists yet. Create one, then add people by hand, from a CSV or Excel file, from the browser extension or from a data provider.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Prospect lists</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">List</th>
                  <th scope="col" className="py-2 text-end font-medium">Prospects</th>
                  <th scope="col" className="py-2 text-end font-medium">With email</th>
                  <th scope="col" className="py-2 text-end font-medium">In CRM</th>
                  <th scope="col" className="py-2 ps-4 font-medium">Assigned to</th>
                  <th scope="col" className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.map((l) => (
                  <tr key={l.id}>
                    <th scope="row" className="py-2 text-start font-normal">
                      <Link href={`/app/prospects/${l.id}`} className="font-medium underline underline-offset-2">{l.name}</Link>
                      {l.samples > 0 && <Badge tone="warning" className="ms-2">{l.samples} sample</Badge>}
                      {l.description && <span className="block text-xs text-muted-foreground">{l.description}</span>}
                    </th>
                    <td className="py-2 text-end tabular-nums">{l.prospects}</td>
                    <td className="py-2 text-end tabular-nums">{l.withEmail}</td>
                    <td className="py-2 text-end tabular-nums">{l.inCrm}</td>
                    <td className="py-2 ps-4">{l.assignee?.name ?? <span className="text-muted-foreground">Nobody</span>}</td>
                    <td className="py-2 text-muted-foreground">{relativeTime(l.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ListForm({ list, onDone }: { list?: ProspectListRow; onDone: (l?: ProspectListRow) => void }) {
  const members = useMembers();
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [assigneeId, setAssigneeId] = useState(list?.assignee?.id ?? '');
  const save = useProspectMutation(
    () => {
      const body = { name, description: description || null, assigneeId: assigneeId || null };
      return list ? prospectsApi.updateList(list.id, body) : prospectsApi.createList(body);
    },
    (l) => onDone(l),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{list ? 'Edit list' : 'New prospect list'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), save.mutate(undefined))}>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">List name</span>
            <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Assigned to</span>
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Nobody</option>
              {members.data?.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name}</option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Description</span>
            <Textarea rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">
            <Alert error={save.error} />
            <Button type="button" variant="ghost" onClick={() => onDone()}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{list ? 'Save list' : 'Create list'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Limits() {
  const s = useProspectSettings();
  const usage = useProspectUsage();
  const canManage = useCan('prospects:manage');
  const [daily, setDaily] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useProspectMutation(
    () =>
      prospectsApi.saveSettings({
        dailyLimit: daily ?? s.data!.dailyLimit,
        userLimits: Object.fromEntries(Object.entries(overrides ?? Object.fromEntries(Object.entries(s.data!.userLimits).map(([k, v]) => [k, String(v)]))).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
      }),
    () => setSaved(true),
  );
  if (!s.data) return s.error ? <Alert error={s.error} /> : <Skeleton className="h-32" />;
  const current = overrides ?? Object.fromEntries(Object.entries(s.data.userLimits).map(([k, v]) => [k, String(v)]));
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 text-sm">
          <p>
            You have used <strong className="tabular-nums">{usage.data?.used ?? 0}</strong> of <strong className="tabular-nums">{usage.data?.limit ?? s.data.dailyLimit}</strong> provider calls in the last 24 hours.
          </p>
          <p className="mt-1 text-muted-foreground">A search, each email address revealed and each address verified count as one call. Calls in Mock Mode count too, so limits behave the same once a key is added.</p>
        </CardContent>
      </Card>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Limits per person</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3 text-sm" onSubmit={(e) => (e.preventDefault(), setSaved(false), save.mutate(undefined))}>
              <label className="block max-w-xs space-y-1">
                <span className="font-medium">Provider calls per person per 24 hours</span>
                <Input type="number" min={0} max={5000} value={daily ?? s.data.dailyLimit} onChange={(e) => (setSaved(false), setDaily(Number(e.target.value)))} />
              </label>
              <table className="w-full max-w-xl">
                <caption className="sr-only">Usage and limits by person</caption>
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 font-medium">Person</th>
                    <th scope="col" className="py-1.5 text-end font-medium">Used (24 h)</th>
                    <th scope="col" className="py-1.5 ps-4 font-medium">Own limit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.data.members.map((m) => (
                    <tr key={m.id}>
                      <th scope="row" className="py-1.5 text-start font-normal">{m.name}</th>
                      <td className="py-1.5 text-end tabular-nums">{m.used}</td>
                      <td className="py-1.5 ps-4">
                        <Input aria-label={`Own limit for ${m.name}`} type="number" min={0} max={5000} placeholder="Default" className="h-9 w-28" value={current[m.id] ?? ''} onChange={(e) => (setSaved(false), setOverrides({ ...current, [m.id]: e.target.value }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-end gap-3">
                <Alert error={save.error} />
                {saved && <Status>Saved.</Status>}
                <Button type="submit" disabled={save.isPending}>Save limits</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ───── One list ─────

function EmailBadge({ p }: { p: Pick<ProspectRow, 'email' | 'emailStatus' | 'suppressed'> }) {
  if (!p.email) return <span className="text-muted-foreground">No email</span>;
  const tone = p.suppressed ? 'critical' : p.emailStatus === 'valid' ? 'success' : p.emailStatus === 'invalid' || p.emailStatus === 'bounced' ? 'critical' : p.emailStatus ? 'warning' : 'neutral';
  return (
    <span>
      <span className="break-all">{p.email}</span>{' '}
      <Badge tone={tone}>{p.suppressed ? 'Do not email' : p.emailStatus ? EMAIL_STATUS_LABELS[p.emailStatus] : 'Not checked'}</Badge>
    </span>
  );
}

function FacetSelect({ label, value, facets, onChange, format }: { label: string; value: string; facets: Facet[]; onChange: (v: string) => void; format?: (v: string) => string }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <Select aria-label={label} className="h-9" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {facets.map((f) => (
          <option key={f.value} value={f.value}>{`${format ? format(f.value) : f.value} (${f.count})`}</option>
        ))}
      </Select>
    </label>
  );
}

type Panel = null | 'add' | 'import' | 'find' | 'edit';

export function ProspectListView({ id }: { id: string }) {
  const router = useRouter();
  const [filters, setFilters] = useState<ProspectFilters>({ sort: 'newest', page: 1 });
  const q = useProspectList(id, filters);
  const canWrite = useCan('prospects:write');
  const canSearch = useCan('prospects:search');
  const canExport = useCan('prospects:export');
  const [panel, setPanel] = useState<Panel>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dedupe = useProspectMutation(() => prospectsApi.dedupe(id), (r) => setNote(r.removed ? `Removed ${r.removed} duplicate${r.removed === 1 ? '' : 's'}.` : 'No duplicates found.'));
  const exportCsv = useProspectMutation(() => prospectsApi.exportCsv(id));
  const del = useProspectMutation(() => prospectsApi.deleteList(id), () => router.push('/app/prospects'));
  const set = (patch: ProspectFilters) => (setSelected(new Set()), setFilters((f) => ({ ...f, page: 1, ...patch })));

  if (!q.data) return q.error ? <Alert error={q.error} /> : <Skeleton className="h-64" />;
  const { list, prospects, facets, total, page, pageSize } = q.data;
  const allOnPage = prospects.length > 0 && prospects.every((p) => selected.has(p.id));
  const toggle = (pid: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(pid)) n.delete(pid);
    else n.add(pid);
    return n;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/app/prospects" className="text-sm text-muted-foreground underline underline-offset-2">All prospect lists</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{list.name}</h1>
          <p className="text-sm text-muted-foreground">
            {list.prospects} prospect{list.prospects === 1 ? '' : 's'} · {list.withEmail} with email · {list.inCrm} in CRM · Assigned to {list.assignee?.name ?? 'nobody'}
          </p>
          {list.description && <p className="mt-1 max-w-2xl text-sm">{list.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && <Button size="sm" onClick={() => setPanel('add')}>Add prospect</Button>}
          {canWrite && <Button size="sm" variant="outline" onClick={() => setPanel('import')}>Import CSV or Excel</Button>}
          {canWrite && canSearch && <Button size="sm" variant="outline" onClick={() => setPanel('find')}>Find prospects</Button>}
          {canWrite && <Button size="sm" variant="outline" disabled={dedupe.isPending} onClick={() => (setNote(null), dedupe.mutate(undefined))}>Remove duplicates</Button>}
          {canExport && <Button size="sm" variant="outline" disabled={exportCsv.isPending} onClick={() => exportCsv.mutate(undefined)}>Export eligible</Button>}
          {canWrite && <Button size="sm" variant="ghost" onClick={() => setPanel('edit')}>Edit list</Button>}
        </div>
      </div>
      {note && <Status>{note}</Status>}
      <Alert error={dedupe.error ?? exportCsv.error} />
      {list.samples > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          This list has {list.samples} sample {list.samples === 1 ? 'person' : 'people'} from Mock Mode. They are not real contacts: they cannot be added to the CRM, enrolled or exported.
        </p>
      )}
      {panel === 'edit' && (
        <div className="space-y-2">
          <ListForm list={list} onDone={() => setPanel(null)} />
          {confirmDelete ? (
            <Button variant="destructive" size="sm" disabled={del.isPending} onClick={() => del.mutate(undefined)}>Delete this list and its {list.prospects} prospects</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>Delete list</Button>
          )}
          <Alert error={del.error} />
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
            <label className="block space-y-1 text-xs sm:col-span-3 lg:col-span-2">
              <span className="font-medium text-muted-foreground">Search</span>
              <Input className="h-9" type="search" placeholder="Name, email, company or title" value={filters.search ?? ''} onChange={(e) => set({ search: e.target.value })} />
            </label>
            <FacetSelect label="Industry" value={filters.industry ?? ''} facets={facets.industry} onChange={(v) => set({ industry: v })} />
            <FacetSelect label="Country" value={filters.country ?? ''} facets={facets.country} onChange={(v) => set({ country: v })} />
            <FacetSelect label="Company size" value={filters.companySize ?? ''} facets={[...facets.companySize].sort((a, b) => COMPANY_SIZES.indexOf(a.value as never) - COMPANY_SIZES.indexOf(b.value as never))} onChange={(v) => set({ companySize: v })} />
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Email</span>
              <Select aria-label="Email" className="h-9" value={filters.emailStatus ?? ''} onChange={(e) => set({ emailStatus: e.target.value })}>
                <option value="">All</option>
                {facets.emailStatus.map((f) => (
                  <option key={f.value} value={f.value}>{`${EMAIL_STATUS_LABELS[f.value as EmailStatus] ?? f.value} (${f.count})`}</option>
                ))}
                <option value="none">No email</option>
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Stage</span>
              <Select aria-label="Stage" className="h-9" value={filters.stage ?? ''} onChange={(e) => set({ stage: e.target.value })}>
                <option value="">All</option>
                <option value="new">Not in CRM</option>
                <option value="in_crm">In CRM</option>
              </Select>
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <FacetSelect label="Job title" value={filters.title ?? ''} facets={facets.title} onChange={(v) => set({ title: v })} />
            <FacetSelect label="Source" value={filters.source ?? ''} facets={facets.source} onChange={(v) => set({ source: v })} format={(v) => PROSPECT_SOURCE_LABELS[v as ProspectSource] ?? v} />
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Sort by</span>
              <Select aria-label="Sort by" className="h-9" value={filters.sort ?? 'newest'} onChange={(e) => set({ sort: e.target.value })}>
                <option value="newest">Newest</option>
                <option value="name">Name</option>
                <option value="company">Company</option>
                <option value="title">Job title</option>
                <option value="country">Country</option>
              </Select>
            </label>
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 && <BulkBar listId={id} ids={[...selected]} onDone={(msg) => (setSelected(new Set()), setNote(msg))} />}

      <Card>
        <CardContent className="overflow-x-auto p-4">
          {!prospects.length ? (
            <p className="text-sm text-muted-foreground">{list.prospects ? 'No prospects match these filters.' : 'This list is empty. Add people by hand, import a file, or find prospects.'}</p>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Prospects in {list.name}</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-8 py-2">
                    <input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(prospects.map((p) => p.id)))} />
                  </th>
                  <th scope="col" className="py-2 font-medium">Person</th>
                  <th scope="col" className="py-2 font-medium">Company</th>
                  <th scope="col" className="py-2 font-medium">Email</th>
                  <th scope="col" className="py-2 font-medium">Country</th>
                  <th scope="col" className="py-2 font-medium">Size</th>
                  <th scope="col" className="py-2 font-medium">Source</th>
                  <th scope="col" className="py-2 font-medium">CRM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {prospects.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">
                      <input type="checkbox" aria-label={`Select ${p.fullName}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    </td>
                    <th scope="row" className="py-2 pe-2 text-start font-normal">
                      <span className="font-medium">{p.fullName}</span>
                      {p.title && <span className="block text-xs text-muted-foreground">{p.title}</span>}
                    </th>
                    <td className="py-2 pe-2">
                      {p.companyName ?? '—'}
                      {(p.domain || p.industry) && <span className="block text-xs text-muted-foreground">{[p.domain, p.industry].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="py-2 pe-2"><EmailBadge p={p} /></td>
                    <td className="py-2 pe-2">{p.country ?? '—'}</td>
                    <td className="py-2 pe-2 tabular-nums">{p.companySize ?? '—'}</td>
                    <td className="py-2 pe-2">{p.sample ? <Badge tone="warning">Sample</Badge> : PROSPECT_SOURCE_LABELS[p.source]}</td>
                    <td className="py-2">
                      {p.crm ? <Link className="underline underline-offset-2" href={`/app/${p.crm.type === 'lead' ? 'leads' : 'contacts'}/${p.crm.id}`}>{p.crm.type === 'lead' ? 'Lead' : 'Contact'}</Link> : <span className="text-muted-foreground">Not yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {total > pageSize && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page * pageSize >= total} onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Performance id={id} />

      {panel === 'add' && <AddDialog listId={id} onClose={() => setPanel(null)} onDone={setNote} />}
      {panel === 'import' && <ImportDialog listId={id} onClose={() => setPanel(null)} onDone={setNote} />}
      {panel === 'find' && <FindDialog listId={id} onClose={() => setPanel(null)} onDone={setNote} />}
    </div>
  );
}

function BulkBar({ listId, ids, onDone }: { listId: string; ids: string[]; onDone: (msg: string) => void }) {
  const lists = useProspectLists();
  const sequences = useSequences();
  const canEnroll = useCan('sequences:write');
  const canSearch = useCan('prospects:search');
  const [target, setTarget] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  const toCrm = useProspectMutation(() => prospectsApi.toCrm(ids, sequenceId || undefined), (r) => {
    const n = (o: string) => r.results.filter((x) => x.outcome === o).length;
    setFailures(r.results.filter((x) => x.reason).map((x) => x.reason!).filter((v, i, a) => a.indexOf(v) === i));
    onDone([`Added ${n('added')} as leads.`, n('existing') ? `${n('existing')} already in the CRM.` : '', n('skipped') ? `${n('skipped')} skipped.` : '', n('failed') ? `${n('failed')} failed.` : '', r.enrollment ? `Enrolled ${r.enrollment.enrolled}${r.enrollment.skipped.length ? `, ${r.enrollment.skipped.length} not enrolled` : ''}.` : ''].filter(Boolean).join(' '));
  });
  const verify = useProspectMutation(() => prospectsApi.verify(ids), (r) => onDone(`Verified ${r.checked} address${r.checked === 1 ? '' : 'es'}${r.skipped ? `; ${r.skipped} skipped (no email or sample)` : ''}.`));
  const move = useProspectMutation((copy: boolean) => prospectsApi.move(ids, target, copy), (r) => onDone(`${r.moved} ${r.moved === 1 ? 'prospect' : 'prospects'} done${r.duplicates ? `; ${r.duplicates} already in that list` : ''}.`));
  const remove = useProspectMutation(() => prospectsApi.remove(ids), (r) => onDone(`Deleted ${r.deleted}.`));
  const err = toCrm.error ?? verify.error ?? move.error ?? remove.error;
  const running = (sequences.data ?? []).filter((s) => s.status === 'ACTIVE');
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 p-4 text-sm">
        <p className="font-medium" role="status">{ids.length} selected</p>
        <div className="flex flex-wrap items-end gap-2">
          {canEnroll && running.length > 0 && (
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Also enrol in sequence</span>
              <Select aria-label="Also enrol in sequence" className="h-9" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)}>
                <option value="">Do not enrol</option>
                {running.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </label>
          )}
          <Button size="sm" disabled={toCrm.isPending} onClick={() => toCrm.mutate(undefined)}>{sequenceId ? 'Add to CRM and enrol' : 'Add to CRM as leads'}</Button>
          {canSearch && <Button size="sm" variant="outline" disabled={verify.isPending} onClick={() => verify.mutate(undefined)}>Verify emails</Button>}
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Other list</span>
            <Select aria-label="Other list" className="h-9" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a list</option>
              {lists.data?.filter((l) => l.id !== listId).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </label>
          <Button size="sm" variant="outline" disabled={!target || move.isPending} onClick={() => move.mutate(false)}>Move</Button>
          <Button size="sm" variant="outline" disabled={!target || move.isPending} onClick={() => move.mutate(true)}>Copy</Button>
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(undefined)}>Delete</Button>
        </div>
        <Alert error={err} />
        {failures.length > 0 && (
          <ul className="list-disc ps-5 text-xs text-muted-foreground" aria-label="Why some were not added">
            {failures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Performance({ id }: { id: string }) {
  const q = useListPerformance(id);
  if (!q.data) return null;
  const rows = q.data.sequences;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outreach from this list</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto text-sm">
        {!rows.length ? (
          <p className="text-muted-foreground">Not sent to a sequence yet. Select prospects, choose a sequence and add them to the CRM to start outreach.</p>
        ) : (
          <table className="w-full min-w-[640px]">
            <caption className="sr-only">Sequence results for this list</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                {['Sequence', 'Enrolled', 'Sent', 'Opened', 'Clicked', 'Replied', 'Bounced', 'Unsubscribed'].map((h, i) => (
                  <th key={h} scope="col" className={cn('py-1.5 font-medium', i && 'text-end')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.sequence.id}>
                  <th scope="row" className="py-1.5 text-start font-normal"><Link className="underline underline-offset-2" href={`/app/sequences/${r.sequence.id}`}>{r.sequence.name}</Link></th>
                  {[r.enrolled, r.sent, r.opened, r.clicked, r.replied, r.bounced, r.unsubscribed].map((v, i) => (
                    <td key={i} className="py-1.5 text-end tabular-nums">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Opens are estimates: mail apps that load images automatically count as opens, and blocked images hide real ones. Replies, bounces and unsubscribes are confirmed events.</p>
      </CardContent>
    </Card>
  );
}

function Sheet({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-2xl">
        <div>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{description}</DialogDescription>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const FIELDS: [ProspectImportField, string, string][] = [
  ['fullName', 'Full name', 'text'], ['email', 'Email', 'email'], ['title', 'Job title', 'text'], ['companyName', 'Company', 'text'], ['domain', 'Company website', 'text'],
  ['industry', 'Industry', 'text'], ['country', 'Country', 'text'], ['phone', 'Phone', 'tel'],
];

function AddDialog({ listId, onClose, onDone }: { listId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const add = useProspectMutation(
    () => prospectsApi.add(listId, [Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()))]),
    (r) => (onDone(addResultText(r)), onClose()),
  );
  return (
    <Sheet title="Add prospect" description="Give an email address, or a name and a company." onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), add.mutate(undefined))}>
        {FIELDS.map(([k, label, type]) => (
          <label key={k} className="block space-y-1 text-sm">
            <span className="font-medium">{label}</span>
            <Input type={type} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Company size</span>
          <Select value={form.companySize ?? ''} onChange={(e) => setForm({ ...form, companySize: e.target.value })}>
            <option value="">Unknown</option>
            {COMPANY_SIZES.map((s) => (
              <option key={s} value={s}>{s} employees</option>
            ))}
          </Select>
        </label>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <Alert error={add.error} />
          <Button type="submit" disabled={add.isPending}>Add to list</Button>
        </div>
      </form>
    </Sheet>
  );
}

function ImportDialog({ listId, onClose, onDone }: { listId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [preview, setPreview] = useState<ProspectImportPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ProspectImportField, number>>>({});
  const [invalid, setInvalid] = useState<{ row: number; message: string }[]>([]);
  const upload = useProspectMutation((f: File) => prospectsApi.importPreview(listId, f), (p) => (setPreview(p), setMapping(p.mapping)));
  const commit = useProspectMutation(() => prospectsApi.importCommit(listId, preview!.importId, mapping), (r) => {
    onDone(addResultText(r));
    if (r.invalid.length) setInvalid(r.invalid);
    else onClose();
  });
  return (
    <Sheet title="Import CSV or Excel" description="A .csv or .xlsx file with a heading row, up to 5,000 rows and 5 MB. You choose which column is which before anything is imported." onClose={onClose}>
      {!preview ? (
        <div className="space-y-2 text-sm">
          <label className="block space-y-1">
            <span className="font-medium">File</span>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} className="block text-sm" />
          </label>
          {upload.isPending && <p className="text-muted-foreground">Reading the file…</p>}
          <Alert error={upload.error} />
        </div>
      ) : invalid.length ? (
        <div className="space-y-2 text-sm">
          <p>These rows were not imported:</p>
          <ul className="max-h-64 list-disc overflow-y-auto ps-5" aria-label="Rows not imported">
            {invalid.map((r) => (
              <li key={r.row}>Row {r.row}: {r.message}</li>
            ))}
          </ul>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form className="space-y-3 text-sm" onSubmit={(e) => (e.preventDefault(), commit.mutate(undefined))}>
          <p>{preview.fileName}: {preview.rows} row{preview.rows === 1 ? '' : 's'}.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROSPECT_IMPORT_FIELDS.map((f) => (
              <label key={f} className="block space-y-1">
                <span className="font-medium">{PROSPECT_IMPORT_FIELD_LABELS[f]}</span>
                <Select aria-label={PROSPECT_IMPORT_FIELD_LABELS[f]} className="h-9" value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">Not in this file</option>
                  {preview.headers.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">First rows of the file</caption>
              <thead className="text-start text-muted-foreground">
                <tr>{preview.headers.map((h, i) => <th key={i} scope="col" className="py-1 pe-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.sample.map((r, i) => (
                  <tr key={i}>{preview.headers.map((_, j) => <td key={j} className="py-1 pe-2">{r[j]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Alert error={commit.error} />
            <Button type="submit" disabled={commit.isPending}>Import {preview.rows} rows</Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

function FindDialog({ listId, onClose, onDone }: { listId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [domains, setDomains] = useState('');
  const [titles, setTitles] = useState('');
  const [countries, setCountries] = useState('');
  const [size, setSize] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ProviderSearchResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState(true);
  const split = (s: string) => s.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
  const search = useProspectMutation(
    (p: number) => prospectsApi.search({ domains: split(domains).map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')), titles: split(titles), countries: split(countries), sizes: size ? [size as never] : [], page: p }),
    (r) => (setResult(r), setPicked(new Set(r.people.map((p) => p.providerId)))),
  );
  const add = useProspectMutation(
    () => prospectsApi.addFromProvider(listId, result!.people.filter((p) => picked.has(p.providerId)) as ProviderPerson[], reveal),
    (r) => (onDone(addResultText(r)), onClose()),
  );
  return (
    <Sheet title="Find prospects" description="Search Apollo.io through DealFlow. Each search and each email address revealed counts towards your daily allowance." onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), setPage(1), search.mutate(1))}>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Company websites</span>
          <Input placeholder="acme.com, example.org" value={domains} onChange={(e) => setDomains(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Job titles</span>
          <Input placeholder="Head of Operations, VP Sales" value={titles} onChange={(e) => setTitles(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Locations</span>
          <Input placeholder="India, Germany" value={countries} onChange={(e) => setCountries(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Company size</span>
          <Select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Any</option>
            {COMPANY_SIZES.map((s) => (
              <option key={s} value={s}>{s} employees</option>
            ))}
          </Select>
        </label>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          <Alert error={search.error} />
          <Button type="submit" disabled={search.isPending}>Search</Button>
        </div>
      </form>
      {result && (
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={MODE_TONE[result.mode]}>{MODE_LABEL[result.mode]}</Badge>
            <span className="text-muted-foreground">{result.usage.used} of {result.usage.limit} provider calls used in the last 24 hours.</span>
          </p>
          {result.notice && <p className={cn('rounded-md p-3', result.mode === 'mock' ? 'border border-warning/40 bg-warning/10' : 'bg-muted')}>{result.notice}</p>}
          {!result.people.length ? (
            <p className="text-muted-foreground">Nobody matched. Try fewer filters.</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border" aria-label="Search results">
                {result.people.map((p) => (
                  <li key={p.providerId} className="flex items-start gap-3 p-2">
                    <input type="checkbox" className="mt-1" aria-label={`Choose ${p.fullName}`} checked={picked.has(p.providerId)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(p.providerId)) n.delete(p.providerId); else n.add(p.providerId); return n; })} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.fullName} {p.sample && <Badge tone="warning">Sample</Badge>}</p>
                      <p className="text-xs text-muted-foreground">{[p.title, p.companyName, p.domain, p.country, p.companySize && `${p.companySize} employees`].filter(Boolean).join(' · ')}</p>
                      {p.email && <p className="text-xs"><EmailBadge p={{ email: p.email, emailStatus: p.emailStatus, suppressed: false }} /></p>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1 || search.isPending} onClick={() => (setPage(page - 1), search.mutate(page - 1))}>Previous</Button>
                  <Button size="sm" variant="outline" disabled={!result.hasMore || search.isPending} onClick={() => (setPage(page + 1), search.mutate(page + 1))}>Next</Button>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
                  Find email addresses ({result.people.filter((p) => picked.has(p.providerId) && !p.email).length} calls)
                </label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Alert error={add.error} />
                <Button disabled={!picked.size || add.isPending} onClick={() => add.mutate(undefined)}>Add {picked.size} to this list</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
