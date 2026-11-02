'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { PORTAL_REQUEST_CATEGORIES, PORTAL_REQUEST_CATEGORY_LABELS, type PortalDashboard, type PortalMe, portalRequestCreateSchema, type PortalRequest } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { Composer, DocumentList, MessageThread, RequestStatus, UploadButton } from '@/components/portal/thread';
import { Field, Tabs } from '@/components/revenue/tabs';
import { ProposalDocument } from '@/app/p/[token]/proposal-view';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import {
  portalPath,
  uploadFile,
  useCustomerDocuments,
  useCustomerMessages,
  useCustomerProposal,
  useCustomerRequest,
  useCustomerRequests,
  usePortalBranding,
  usePortalDashboard,
  usePortalMe,
} from '@/lib/portal';
import { LoginForm } from './password-forms';
import { PortalFrame } from './portal-frame';
import { useT } from '@/lib/i18n';

type Tab = 'overview' | 'proposals' | 'documents' | 'requests' | 'messages';

export function PortalApp({ slug }: { slug: string }) {
  const t = useT();
  const qc = useQueryClient();
  const branding = usePortalBranding(slug);
  const me = usePortalMe();
  const signedIn = !!me.data && me.data.branding.slug === slug;
  const [tab, setTab] = useState<Tab>('overview');

  const logout = async () => {
    await api(portalPath('/logout'), { method: 'POST' });
    // Forget everything the customer saw, then show the sign-in form.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'client-portal' && q.queryKey[1] !== 'me' && q.queryKey[1] !== 'branding' });
    qc.setQueryData(['client-portal', 'me'], null);
    setTab('overview');
  };

  if (branding.isPending || me.isPending) return <PortalFrame branding={null}><Skeleton className="h-80" /></PortalFrame>;
  if (!signedIn)
    return (
      <PortalFrame branding={branding.data ?? null} missing={branding.isError}>
        <div className="mx-auto max-w-md space-y-6">
          {branding.data?.welcome && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{branding.data.welcome}</p>}
          <Card>
            <CardContent className="p-6">
              <LoginForm slug={slug} />
            </CardContent>
          </Card>
        </div>
      </PortalFrame>
    );

  const m = me.data!;
  const f = m.features;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: m.unreadUpdates ? t('Overview ({n} new)', { n: m.unreadUpdates }) : t('Overview') },
    ...(f.showQuotes ? [{ key: 'proposals' as const, label: t('Proposals') }] : []),
    ...(f.showDocuments ? [{ key: 'documents' as const, label: t('Documents') }] : []),
    ...(f.allowRequests ? [{ key: 'requests' as const, label: t('Requests') }] : []),
    ...(f.allowMessages ? [{ key: 'messages' as const, label: t('Messages') }] : []),
  ];
  return (
    <PortalFrame
      branding={m.branding}
      right={
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden text-muted-foreground sm:inline">
            {m.user.name}, {m.company.name}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={logout}>
            <LogOut aria-hidden /> {t('Sign out')}
          </Button>
        </div>
      }
    >
      <Tabs label={t('Portal sections')} tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview me={m} onOpen={setTab} />}
      {tab === 'proposals' && <Proposals me={m} />}
      {tab === 'documents' && <Documents me={m} />}
      {tab === 'requests' && <Requests />}
      {tab === 'messages' && <Messages me={m} />}
    </PortalFrame>
  );
}

function Overview({ me, onOpen }: { me: PortalMe; onOpen: (t: Tab) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const d = usePortalDashboard(true);
  const marked = useRef(false);
  useEffect(() => {
    if (!d.data || marked.current || !me.unreadUpdates) return;
    marked.current = true;
    // Seen once shown; the "new" marks stay on screen until the next visit.
    void api(portalPath('/updates/seen'), { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['client-portal', 'me'] }));
  }, [d.data, me.unreadUpdates, qc]);
  if (d.isPending) return <Skeleton className="h-80" />;
  if (d.error) return <p role="alert" className="text-sm text-critical">{d.error.message}</p>;
  const x: PortalDashboard = d.data;
  const f = me.features;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {me.branding.welcome && (
          <Card>
            <CardContent className="whitespace-pre-wrap p-5 text-sm">{me.branding.welcome}</CardContent>
          </Card>
        )}
        {f.showDeals && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Your projects')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!x.deals.length && <p className="text-sm text-muted-foreground">{t('Nothing in progress yet.')}</p>}
              {x.deals.map((deal) => (
                <div key={deal.id} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{deal.name}</span>
                    <span className="text-muted-foreground">
                      {deal.status === 'WON' ? t('Complete') : deal.status === 'LOST' ? t('Closed') : deal.stage}
                      {deal.status === 'OPEN' && deal.expectedCloseDate && ` · ${t('expected {date}', { date: formatDate(deal.expectedCloseDate) })}`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted" role="progressbar" aria-label={t('{name} progress', { name: deal.name })} aria-valuenow={deal.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-2 rounded-full" style={{ width: `${deal.progress}%`, background: 'var(--portal-accent, hsl(var(--primary)))' }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {f.showTasks && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Milestones')}</CardTitle>
            </CardHeader>
            <CardContent>
              {!x.milestones.length ? (
                <p className="text-sm text-muted-foreground">{t('Your account team has not shared any milestones yet.')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {x.milestones.map((m) => (
                    <li key={m.id} className="flex items-start gap-2">
                      {m.done ? <CheckCircle2 className="mt-0.5 size-4 text-success" aria-label={t('Done')} /> : <Circle className="mt-0.5 size-4 text-muted-foreground" aria-label={t('To do')} />}
                      <span className="flex-1">
                        {m.title}
                        {m.deal && <span className="block text-xs text-muted-foreground">{m.deal}</span>}
                      </span>
                      {m.dueAt && <span className="text-xs text-muted-foreground">{formatDate(m.dueAt)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        {f.showContracts && x.contracts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Contracts')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {x.contracts.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">
                      {c.status.toLowerCase()} · {formatDate(c.startDate)}
                      {c.endDate && ` to ${formatDate(c.endDate)}`} · {formatMoney(c.value, c.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Your account manager')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {me.accountManager ? (
              <>
                <p className="font-medium">{me.accountManager.name}</p>
                <a className="text-primary hover:underline" href={`mailto:${me.accountManager.email}`}>
                  {me.accountManager.email}
                </a>
              </>
            ) : (
              <p className="text-muted-foreground">{t('Not assigned yet.')}</p>
            )}
            {me.features.allowRequests && (
              <p className="pt-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onOpen('requests')}>
                  {x.openRequests ? t.plural('count.openRequests', x.openRequests) : t('Ask for help')}
                </Button>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Latest updates')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!x.updates.length ? (
              <p className="text-sm text-muted-foreground">{t('No updates yet.')}</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {x.updates.map((u) => (
                  <li key={u.id}>
                    <p className="font-medium">
                      {u.title} {u.unread && <Badge tone="primary">{t('New')}</Badge>}
                    </p>
                    {u.body && <p className="text-muted-foreground">{u.body}</p>}
                    <p className="text-xs text-muted-foreground">{relativeTime(u.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Invoices')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('Invoices are not available in this portal yet. Your account manager can send copies.')}</CardContent>
        </Card>
      </div>
    </div>
  );
}

function Proposals({ me }: { me: PortalMe }) {
  const t = useT();
  const d = usePortalDashboard(true);
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <ProposalDetail id={open} me={me} onBack={() => setOpen(null)} />;
  if (d.isPending) return <Skeleton className="h-60" />;
  const rows = d.data?.proposals ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        {!rows.length ? (
          <p className="p-6 text-sm text-muted-foreground">{t('No proposals have been shared with you yet.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1">
                  <span className="block font-medium">{p.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.reference} · {formatMoney(p.total, p.currency)}
                    {p.validUntil && ` · ${t('valid until {date}', { date: formatDate(p.validUntil) })}`}
                  </span>
                </span>
                {p.status === 'ACCEPTED' ? <Badge tone="success">{t('Approved')}</Badge> : p.status === 'DECLINED' ? <Badge>{t('Declined')}</Badge> : p.canDecide ? <Badge tone="warning">{t('Waiting for your decision')}</Badge> : <Badge tone="primary">{t('Sent')}</Badge>}
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(p.id)} aria-label={t('Open {title}', { title: p.title })}>
                  {t('Open')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProposalDetail({ id, me, onBack }: { id: string; me: PortalMe; onBack: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const p = useCustomerProposal(id);
  const d = usePortalDashboard(true);
  const row = d.data?.proposals.find((x) => x.id === id);
  const [choice, setChoice] = useState<'accept' | 'decline' | null>(null);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const decide = useMutation({
    mutationFn: () => api<{ status: string }>(portalPath(`/proposals/${id}/decision`), { method: 'POST', json: { decision: choice, note: note.trim() || undefined } }),
    onSuccess: async () => {
      setChoice(null);
      await qc.invalidateQueries({ queryKey: ['client-portal'] });
    },
  });
  if (p.isPending) return <Skeleton className="h-96" />;
  if (p.error) return <p role="alert" className="text-sm text-critical">{p.error.message}</p>;
  const canDecide = !!row?.canDecide;
  return (
    <div className="space-y-4">
      <Button type="button" variant="link" size="sm" className="px-0" onClick={onBack}>
        {t('← All proposals')}
      </Button>
      <Card>
        <CardContent className="p-6">
          <ProposalDocument
            p={p.data}
            actions={
              <div className="space-y-3 border-t border-border pt-4">
                {canDecide && !choice && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => { setChoice('accept'); setConfirmed(false); }}>
                      {t('Approve proposal')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => { setChoice('decline'); setConfirmed(false); }}>
                      {t('Decline')}
                    </Button>
                  </div>
                )}
                {canDecide && choice && (
                  <form
                    className="space-y-3 rounded-md border border-border p-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      decide.mutate();
                    }}
                    aria-label={choice === 'accept' ? t('Approve proposal') : t('Decline proposal')}
                  >
                    <Field id="decision-note" label={choice === 'accept' ? t('Note for the account team (optional)') : t('Reason (optional)')}>
                      <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                    </Field>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                      <span>
                        {choice === 'accept'
                          ? t('I approve {reference} for {amount} on behalf of {company}.', { reference: p.data.reference, amount: formatMoney(p.data.total, p.data.currency), company: me.company.name })
                          : t('I decline {reference} on behalf of {company}.', { reference: p.data.reference, company: me.company.name })}
                      </span>
                    </label>
                    {decide.error && <p role="alert" className="text-sm text-critical">{decide.error.message}</p>}
                    <div className="flex gap-2">
                      <Button type="submit" disabled={!confirmed || decide.isPending} variant={choice === 'accept' ? 'default' : 'destructive'}>
                        {choice === 'accept' ? t('Confirm approval') : t('Confirm decline')}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setChoice(null)}>
                        {t('Cancel')}
                      </Button>
                    </div>
                  </form>
                )}
                {!canDecide && p.data.status === 'SENT' && (
                  <p className="text-xs text-muted-foreground">
                    {me.features.allowApprovals ? (me.user.role === 'approver' ? t('This proposal can no longer be approved here. Ask your account manager for an updated one.') : t('Someone at your company with approval rights can approve this proposal here.')) : t('To accept or ask a question, contact your account manager.')}
                  </p>
                )}
                {decide.data && <p role="status" className="text-sm">{decide.data.status === 'ACCEPTED' ? t('Thank you. The proposal is approved and your account team has been told.') : t('The proposal is declined and your account team has been told.')}</p>}
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Documents({ me }: { me: PortalMe }) {
  const t = useT();
  const qc = useQueryClient();
  const docs = useCustomerDocuments(true);
  const upload = useMutation({
    mutationFn: (f: File) => uploadFile(portalPath('/documents'), f),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-portal', 'documents'] }),
  });
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t('Shared documents')}</CardTitle>
        {me.features.allowUploads && <UploadButton label={t('Upload a document')} pending={upload.isPending} onFile={(f) => upload.mutate(f)} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {upload.error && <p role="alert" className="text-sm text-critical">{upload.error.message}</p>}
        {docs.isPending ? <Skeleton className="h-24" /> : <DocumentList docs={docs.data ?? []} mine="customer" />}
        <p className="text-xs text-muted-foreground">{t('PDF, images, text, CSV and Office files up to 10 MB.')}</p>
      </CardContent>
    </Card>
  );
}

function Requests() {
  const t = useT();
  const qc = useQueryClient();
  const list = useCustomerRequests(true);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (open) return <RequestDetail id={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      {creating ? (
        <NewRequest
          onDone={async (r) => {
            setCreating(false);
            await qc.invalidateQueries({ queryKey: ['client-portal'] });
            if (r) setOpen(r.id);
          }}
        />
      ) : (
        <Button type="button" onClick={() => setCreating(true)}>
          {t('New request')}
        </Button>
      )}
      <Card>
        <CardContent className="p-0">
          {list.isPending ? (
            <Skeleton className="h-24" />
          ) : !list.data?.length ? (
            <p className="p-6 text-sm text-muted-foreground">{t('No requests yet. Ask a question, report a problem or ask for a change.')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.data.map((r) => (
                <li key={r.id}>
                  <button type="button" className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-start text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => setOpen(r.id)}>
                    <span className="flex-1">
                      <span className="block font-medium">{r.subject}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.reference} · {t.maybe(PORTAL_REQUEST_CATEGORY_LABELS[r.category])} · {t('updated {time}', { time: relativeTime(r.lastMessageAt) })}
                      </span>
                    </span>
                    <RequestStatus status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewRequest({ onDone }: { onDone: (r: PortalRequest | null) => void }) {
  const t = useT();
  const [v, setV] = useState({ subject: '', category: 'question', body: '' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: (body: typeof v) => api<PortalRequest>(portalPath('/requests'), { method: 'POST', json: body }), onSuccess: (r) => onDone(r) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('New request')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const r = portalRequestCreateSchema.safeParse(v);
            if (!r.success) return setError(r.error.issues[0]!.message);
            setError(null);
            create.mutate(v);
          }}
        >
          <Field id="req-subject" label={t('Subject')}>
            <Input id="req-subject" value={v.subject} maxLength={200} onChange={(e) => setV({ ...v, subject: e.target.value })} />
          </Field>
          <Field id="req-category" label={t('Type')}>
            <Select id="req-category" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
              {PORTAL_REQUEST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.maybe(PORTAL_REQUEST_CATEGORY_LABELS[c])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="req-body" label={t('Details')}>
            <Textarea id="req-body" value={v.body} maxLength={10000} onChange={(e) => setV({ ...v, body: e.target.value })} />
          </Field>
          {(error || create.error) && <p role="alert" className="text-sm text-critical">{error ?? create.error?.message}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {t('Send request')}
            </Button>
            <Button type="button" variant="outline" onClick={() => onDone(null)}>
              {t('Cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const r = useCustomerRequest(id);
  const reply = useMutation({
    mutationFn: (body: string) => api<PortalRequest>(portalPath(`/requests/${id}/messages`), { method: 'POST', json: { body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-portal'] }),
  });
  return (
    <div className="space-y-4">
      <Button type="button" variant="link" size="sm" className="px-0" onClick={onBack}>
        {t('← All requests')}
      </Button>
      {r.isPending ? (
        <Skeleton className="h-60" />
      ) : r.error ? (
        <p role="alert" className="text-sm text-critical">{r.error.message}</p>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{r.data.subject}</CardTitle>
              <RequestStatus status={r.data.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {r.data.reference} · {t.maybe(PORTAL_REQUEST_CATEGORY_LABELS[r.data.category])}
              {r.data.assignedTo && ` · ${t('handled by {name}', { name: r.data.assignedTo.name })}`}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <MessageThread messages={r.data.messages} mine="customer" empty={t('No messages yet.')} />
            {r.data.status === 'closed' ? (
              <p className="text-sm text-muted-foreground">{t('This request is closed. Open a new one if you need more help.')}</p>
            ) : (
              <Composer label={t('Reply')} button={t('Send reply')} pending={reply.isPending} error={reply.error} onSend={(b) => reply.mutateAsync(b)} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Messages({ me }: { me: PortalMe }) {
  const t = useT();
  const qc = useQueryClient();
  const msgs = useCustomerMessages(true);
  const send = useMutation({
    mutationFn: (body: string) => api(portalPath('/messages'), { method: 'POST', json: { body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-portal', 'messages'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Messages with your account team')}</CardTitle>
        {me.accountManager && <p className="text-xs text-muted-foreground">{t('{name} and the team see these messages.', { name: me.accountManager.name })}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {msgs.isPending ? <Skeleton className="h-24" /> : <MessageThread messages={msgs.data ?? []} mine="customer" empty={t('No messages yet.')} />}
        <Composer label={t('Message')} button={t('Send message')} pending={send.isPending} error={send.error} onSend={(b) => send.mutateAsync(b)} />
      </CardContent>
    </Card>
  );
}
