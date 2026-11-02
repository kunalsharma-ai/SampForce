'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { PORTAL_REQUEST_CATEGORY_LABELS, PORTAL_REQUEST_STATUSES, PORTAL_REQUEST_STATUS_LABELS, PORTAL_ROLE_LABELS, type PortalRequest, type PortalSettings, type PortalSettingsInput, portalSettingsSchema } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { Composer, MessageThread, RequestStatus } from '@/components/portal/thread';
import { Field, Tabs } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useMembers } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { usePortalRequest, usePortalRequests, usePortalSettings, usePortalUsers } from '@/lib/portal';
import { useCan } from '@/lib/session';
import { rich, useT } from '@/lib/i18n';

type Tab = 'requests' | 'people' | 'settings';

export function PortalWorkspace({ initialRequest }: { initialRequest: string | null }) {
  const t = useT();
  const settings = usePortalSettings();
  const canManage = useCan('tenant:manage');
  const [tab, setTab] = useState<Tab>('requests');
  if (settings.isPending) return <Skeleton className="h-60" />;
  if (settings.error) return <p role="alert" className="text-sm text-critical">{settings.error.message}</p>;
  const s = settings.data;
  return (
    <div className="space-y-4">
      <StatusCard s={s} onSetUp={() => setTab('settings')} canManage={canManage} />
      <Tabs
        label={t('Client portal')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'requests', label: t('Requests') },
          { key: 'people', label: t('People with access') },
          ...(canManage ? [{ key: 'settings' as const, label: t('Portal settings') }] : []),
        ]}
      />
      {tab === 'requests' && <Inbox initial={initialRequest} />}
      {tab === 'people' && <People />}
      {tab === 'settings' && canManage && <SettingsForm initial={s} />}
    </div>
  );
}

function StatusCard({ s, canManage, onSetUp }: { s: PortalSettings; canManage: boolean; onSetUp: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-5 text-sm">
        {s.enabled ? <Badge tone="success">{t('Portal on')}</Badge> : <Badge>{s.updatedAt ? t('Portal off') : t('Not set up')}</Badge>}
        <span className="flex-1 break-all">
          {s.enabled ? (
            <>
              {rich(t('Customers sign in at {url}'), { url: <span className="font-medium">{s.url}</span> })}
            </>
          ) : s.updatedAt ? (
            t('Customers cannot sign in while the portal is off. Their access and history are kept.')
          ) : (
            t('Choose the portal address and what customers can see, then invite people from a company page.')
          )}
        </span>
        {s.enabled && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(s.url).then(() => setCopied(true));
              }}
            >
              <Copy aria-hidden /> {copied ? t('Copied') : t('Copy address')}
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden /> {t('Open sign-in page')}
              </a>
            </Button>
          </>
        )}
        {!s.updatedAt && canManage && (
          <Button type="button" size="sm" onClick={onSetUp}>
            {t('Set up the portal')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const TOGGLES: { key: keyof PortalSettingsInput; label: string; hint?: string }[] = [
  { key: 'showDeals', label: 'Projects and their progress', hint: 'Open, won and lost deals with the company, shown as a stage and a progress bar. Amounts are not shown.' },
  { key: 'showTasks', label: 'Milestones', hint: 'Only tasks you mark "Show in portal" on the company page.' },
  { key: 'showQuotes', label: 'Proposals', hint: 'Sent, accepted and declined quotes. Drafts and internal approvals are never shown.' },
  { key: 'allowApprovals', label: 'Let approvers approve or decline proposals', hint: 'Only people you give the "Can also approve proposals" role.' },
  { key: 'showContracts', label: 'Contracts' },
  { key: 'showDocuments', label: 'Shared documents' },
  { key: 'allowUploads', label: 'Let customers upload documents' },
  { key: 'allowRequests', label: 'Support and change requests' },
  { key: 'allowMessages', label: 'Messages with the account team' },
];

function SettingsForm({ initial }: { initial: PortalSettings }) {
  const t = useT();
  const qc = useQueryClient();
  const { url: _u, updatedAt: _a, ...start } = initial;
  const [v, setV] = useState<PortalSettingsInput>(start);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: PortalSettingsInput) => api<PortalSettings>('/portal/settings', { method: 'PUT', json: body }),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['portal'] });
    },
  });
  return (
    <Card>
      <CardContent className="p-6">
        <form
          className="space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            const r = portalSettingsSchema.safeParse(v);
            if (!r.success) return setError(t.maybe(r.error.issues[0]!.message));
            setError(null);
            save.mutate(r.data);
          }}
        >
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
            {t('Portal is on')}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ps-slug" label={t('Portal address')} hint={`${initial.url.replace(/[^/]+$/, '')}${v.slug || '…'}`}>
              <Input id="ps-slug" value={v.slug} maxLength={40} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} />
            </Field>
            <Field id="ps-title" label={t('Portal name')} hint={t('Shown at the top of every portal page.')}>
              <Input id="ps-title" value={v.title ?? ''} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value || null })} />
            </Field>
          </div>
          <Field id="ps-welcome" label={t('Welcome message')} hint={t('Shown on the sign-in page and the overview.')}>
            <Textarea id="ps-welcome" value={v.welcome ?? ''} maxLength={2000} onChange={(e) => setV({ ...v, welcome: e.target.value || null })} />
          </Field>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">{t('What customers can see and do')}</legend>
            {TOGGLES.map((item) => (
              <label key={item.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={v[item.key] as boolean} onChange={(e) => setV({ ...v, [item.key]: e.target.checked })} />
                <span>
                  {t.maybe(item.label)}
                  {item.hint && <span className="block text-xs text-muted-foreground">{t.maybe(item.hint)}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">{t("Invoices are not shown: customer invoicing is not connected to DealFlow yet. Internal notes, amounts on deals, health scores and other customers' records are never shown.")}</p>
          {(error || save.error) && <p role="alert" className="text-sm text-critical">{error ?? save.error?.message}</p>}
          {saved && <p role="status" className="text-sm">{t('Portal settings saved.')}</p>}
          <Button type="submit" disabled={save.isPending}>
            {t('Save portal settings')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function People() {
  const t = useT();
  const users = usePortalUsers();
  if (users.isPending) return <Skeleton className="h-40" />;
  return (
    <Card>
      <CardContent className="p-0">
        {!users.data?.length ? (
          <p className="p-6 text-sm text-muted-foreground">{t('Nobody has portal access yet. Open a company and use the Client portal card to invite someone.')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2 font-medium">{t('Person')}</th>
                <th className="px-5 py-2 font-medium">{t('Company')}</th>
                <th className="px-5 py-2 font-medium">{t('Access')}</th>
                <th className="px-5 py-2 font-medium">{t('Status')}</th>
                <th className="px-5 py-2 font-medium">{t('Last sign-in')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-2">
                    <span className="block font-medium">{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.email}</span>
                  </td>
                  <td className="px-5 py-2">
                    <Link className="text-primary hover:underline" href={`/app/companies/${u.company.id}`}>
                      {u.company.name}
                    </Link>
                  </td>
                  <td className="px-5 py-2">{PORTAL_ROLE_LABELS[u.role]}</td>
                  <td className="px-5 py-2">
                    <UserStatus status={u.status} />
                  </td>
                  <td className="px-5 py-2 text-muted-foreground">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : t('Never')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export function UserStatus({ status }: { status: 'invited' | 'active' | 'disabled' }) {
  const t = useT();
  return status === 'active' ? <Badge tone="success">{t('Active')}</Badge> : status === 'invited' ? <Badge tone="warning">{t('Invited')}</Badge> : <Badge>{t('Switched off')}</Badge>;
}

function Inbox({ initial }: { initial: string | null }) {
  const t = useT();
  const [status, setStatus] = useState('active');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<string | null>(initial);
  const list = usePortalRequests({ status: status || undefined, mine });
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="pr-status" label={t('Show')}>
            <Select id="pr-status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">{t('Open and in progress')}</option>
              {PORTAL_REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.maybe(PORTAL_REQUEST_STATUS_LABELS[s])}
                </option>
              ))}
              <option value="">{t('All')}</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t('Assigned to me')}
          </label>
        </div>
        <Card>
          <CardContent className="p-0">
            {list.isPending ? (
              <Skeleton className="h-24" />
            ) : !list.data?.length ? (
              <p className="p-5 text-sm text-muted-foreground">{t('No requests here.')}</p>
            ) : (
              <ul className="divide-y divide-border" aria-label={t('Portal requests')}>
                {list.data.map((r) => (
                  <li key={r.id}>
                    <button type="button" aria-current={open === r.id ? 'true' : undefined} className="flex w-full flex-col gap-1 px-4 py-3 text-start text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-muted/60" onClick={() => setOpen(r.id)}>
                      <span className="flex items-center gap-2">
                        <span className="flex-1 font-medium">{r.subject}</span>
                        <RequestStatus status={r.status} />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.reference} · {r.company.name} · {t.maybe(PORTAL_REQUEST_CATEGORY_LABELS[r.category])} · {relativeTime(r.lastMessageAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="lg:col-span-3">{open ? <RequestPanel id={open} /> : <p className="text-sm text-muted-foreground">{t('Choose a request to read and answer it.')}</p>}</div>
    </div>
  );
}

function RequestPanel({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const r = usePortalRequest(id);
  const members = useMembers();
  const canWrite = useCan('companies:write');
  const refresh = () => qc.invalidateQueries({ queryKey: ['portal'] });
  const update = useMutation({ mutationFn: (body: { status?: string; assignedToId?: string | null }) => api<PortalRequest>(`/portal/requests/${id}`, { method: 'PATCH', json: body }), onSuccess: refresh });
  const reply = useMutation({ mutationFn: (body: string) => api<PortalRequest>(`/portal/requests/${id}/messages`, { method: 'POST', json: { body } }), onSuccess: refresh });
  if (r.isPending) return <Skeleton className="h-60" />;
  if (r.error) return <p role="alert" className="text-sm text-critical">{r.error.message}</p>;
  const x = r.data;
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{x.subject}</CardTitle>
          <RequestStatus status={x.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {x.reference} · {t.maybe(PORTAL_REQUEST_CATEGORY_LABELS[x.category])} ·{' '}
          {rich(t('from {person} at {company}'), {
            person: x.openedBy ?? t('a former portal user'),
            company: (
              <Link className="text-primary hover:underline" href={`/app/companies/${x.company.id}`}>
                {x.company.name}
              </Link>
            ),
          })}
        </p>
        {canWrite && (
          <div className="flex flex-wrap gap-3">
            <Field id="rq-status" label={t('Status')}>
              <Select id="rq-status" className="w-auto" value={x.status} onChange={(e) => update.mutate({ status: e.target.value })}>
                {PORTAL_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.maybe(PORTAL_REQUEST_STATUS_LABELS[s])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="rq-assignee" label={t('Assigned to')}>
              <Select id="rq-assignee" className="w-auto" value={x.assignedTo?.id ?? ''} onChange={(e) => update.mutate({ assignedToId: e.target.value || null })}>
                <option value="">{t('Nobody')}</option>
                {members.data?.filter((m) => m.status === 'ACTIVE').map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {update.error && <p role="alert" className="text-sm text-critical">{update.error.message}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <MessageThread messages={x.messages} mine="team" empty={t('No messages.')} />
        {canWrite && x.status !== 'closed' && <Composer label={t('Reply to the customer')} button={t('Send reply')} pending={reply.isPending} error={reply.error} onSend={(b) => reply.mutateAsync(b)} />}
        {x.status === 'closed' && <p className="text-sm text-muted-foreground">{t('Closed. Change the status to reply again.')}</p>}
        <p className="text-xs text-muted-foreground">{t('The customer sees replies in the portal. When email is set up, the person who opened the request also gets a short email saying there is a reply.')}</p>
      </CardContent>
    </Card>
  );
}
