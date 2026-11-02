'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { type ContactRow, PORTAL_REQUEST_CATEGORY_LABELS, PORTAL_ROLE_LABELS, PORTAL_ROLES, type PortalRole, type PortalUserRow, portalInviteSchema } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { Field, Tabs } from '@/components/revenue/tabs';
import { UserStatus } from '@/app/app/portal/portal-workspace';
import { api } from '@/lib/api';
import { formatDate, useRecordList } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { uploadFile, useCompanyPortal } from '@/lib/portal';
import { useCan } from '@/lib/session';
import { Composer, DocumentList, MessageThread, RequestStatus, UploadButton } from './thread';
import { useT } from '@/lib/i18n';

type Tab = 'people' | 'milestones' | 'documents' | 'messages' | 'requests';

/** The client portal for one company: who has access, and what is shared with them. */
export function CompanyPortal({ company }: { company: { id: string; name: string } }) {
  const t = useT();
  const qc = useQueryClient();
  const portal = useCompanyPortal(company.id);
  const canWrite = useCan('companies:write');
  const canTasks = useCan('activities:write');
  const [tab, setTab] = useState<Tab>('people');
  const refresh = () => qc.invalidateQueries({ queryKey: ['portal'] });
  const upload = useMutation({ mutationFn: (f: File) => uploadFile(`/portal/companies/${company.id}/documents`, f), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/portal/documents/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const message = useMutation({ mutationFn: (body: string) => api(`/portal/companies/${company.id}/messages`, { method: 'POST', json: { body } }), onSuccess: refresh });
  const share = useMutation({ mutationFn: (t: { id: string; visible: boolean }) => api(`/portal/tasks/${t.id}/visibility`, { method: 'PUT', json: { visible: t.visible } }), onSuccess: refresh });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Client portal')}</CardTitle>
        {portal.data && (
          <p className="text-xs text-muted-foreground">
            {portal.data.url === null ? (
              <>
                {t('The portal is not set up yet.')} <Link className="text-primary underline underline-offset-2" href="/app/portal">{t('Set it up')}</Link>
              </>
            ) : portal.data.enabled ? (
              <>{t('Customers sign in at {url}', { url: portal.data.url ?? '' })}</>
            ) : (
              <>
                {t('The portal is switched off, so nobody can sign in.')} <Link className="text-primary underline underline-offset-2" href="/app/portal">{t('Portal settings')}</Link>
              </>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {portal.isPending ? (
          <Skeleton className="h-24" />
        ) : portal.error ? (
          <p role="alert" className="text-sm text-critical">{portal.error.message}</p>
        ) : (
          <>
            <Tabs
              label={t('{name} portal', { name: company.name })}
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'people', label: t('People ({n})', { n: portal.data.users.length }) },
                { key: 'milestones', label: t('Milestones') },
                { key: 'documents', label: t('Documents ({n})', { n: portal.data.documents.length }) },
                { key: 'messages', label: t('Messages') },
                { key: 'requests', label: t('Requests ({n})', { n: portal.data.requests.length }) },
              ]}
            />
            {tab === 'people' && <PeopleTab companyId={company.id} users={portal.data.users} canWrite={canWrite && portal.data.url !== null} onChange={refresh} />}
            {tab === 'milestones' && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t('Tick a task to show it to the customer as a milestone, with its title, due date and whether it is done. Descriptions stay internal.')}</p>
                {!portal.data.tasks.length ? (
                  <p className="text-sm text-muted-foreground">{t("No tasks on this company's deals or contacts yet.")}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {portal.data.tasks.map((task) => (
                      <li key={task.id}>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="mt-1" checked={task.portalVisible} disabled={!canTasks || share.isPending} onChange={(e) => share.mutate({ id: task.id, visible: e.target.checked })} aria-label={t('Show "{title}" in portal', { title: task.title })} />
                          <span className="flex-1">
                            {task.title}
                            <span className="block text-xs text-muted-foreground">
                              {[task.deal, task.dueAt && t('due {date}', { date: formatDate(task.dueAt) }), task.done && t('done')].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {tab === 'documents' && (
              <div className="space-y-3">
                {canWrite && <UploadButton label={t('Share a document')} pending={upload.isPending} onFile={(f) => upload.mutate(f)} />}
                {(upload.error || remove.error) && <p role="alert" className="text-sm text-critical">{(upload.error ?? remove.error)?.message}</p>}
                <DocumentList docs={portal.data.documents} mine="team" onRemove={canWrite ? (d) => { if (window.confirm(t('Remove {name} from the portal? The customer will no longer see it.', { name: d.name }))) remove.mutate(d.id); } : undefined} />
              </div>
            )}
            {tab === 'messages' && (
              <div className="space-y-4">
                <MessageThread messages={portal.data.messages} mine="team" empty={t('No messages with this customer yet.')} />
                {canWrite && <Composer label={t('Message to the customer')} button={t('Send message')} pending={message.isPending} error={message.error} onSend={(b) => message.mutateAsync(b)} />}
              </div>
            )}
            {tab === 'requests' &&
              (!portal.data.requests.length ? (
                <p className="text-sm text-muted-foreground">{t('No requests from this customer.')}</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {portal.data.requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                      <Link className="flex-1 font-medium text-primary hover:underline" href={`/app/portal?id=${r.id}`}>
                        {r.subject}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {r.reference} · {t.maybe(PORTAL_REQUEST_CATEGORY_LABELS[r.category])} · {relativeTime(r.lastMessageAt)}
                      </span>
                      <RequestStatus status={r.status} />
                    </li>
                  ))}
                </ul>
              ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PeopleTab({ companyId, users, canWrite, onChange }: { companyId: string; users: PortalUserRow[]; canWrite: boolean; onChange: () => void }) {
  const t = useT();
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ url: string; emailed: boolean; name: string } | null>(null);
  const update = useMutation({ mutationFn: (x: { id: string; role?: PortalRole; status?: 'active' | 'disabled' }) => api(`/portal/users/${x.id}`, { method: 'PATCH', json: { role: x.role, status: x.status } }), onSuccess: onChange });
  const resend = useMutation({
    mutationFn: (u: PortalUserRow) => api<{ inviteUrl: string; emailed: boolean }>(`/portal/users/${u.id}/invitation`, { method: 'POST' }).then((r) => ({ ...r, name: u.name })),
    onSuccess: (r) => setLink({ url: r.inviteUrl, emailed: r.emailed, name: r.name }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/portal/users/${id}`, { method: 'DELETE' }), onSuccess: onChange });
  const err = update.error ?? resend.error ?? remove.error;
  return (
    <div className="space-y-3">
      {link && <InviteLink {...link} onClose={() => setLink(null)} />}
      {err && <p role="alert" className="text-sm text-critical">{err.message}</p>}
      {!users.length && !inviting && <p className="text-sm text-muted-foreground">{t('Nobody at this company has portal access yet.')}</p>}
      {users.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-40 flex-1">
                <span className="block font-medium">{u.name}</span>
                <span className="text-xs text-muted-foreground">
                  {u.email} · {u.lastLoginAt ? t('last signed in {time}', { time: relativeTime(u.lastLoginAt) }) : t('never signed in')}
                </span>
              </span>
              <UserStatus status={u.status} />
              {canWrite && (
                <>
                  <Select aria-label={t('Access for {name}', { name: u.name })} className="h-8 w-auto text-xs" value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as PortalRole })}>
                    {PORTAL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t.maybe(PORTAL_ROLE_LABELS[r])}
                      </option>
                    ))}
                  </Select>
                  {u.status === 'invited' && (
                    <Button type="button" size="sm" variant="outline" onClick={() => resend.mutate(u)}>
                      {t('New invitation link')}
                    </Button>
                  )}
                  {u.status === 'active' && (
                    <Button type="button" size="sm" variant="outline" onClick={() => update.mutate({ id: u.id, status: 'disabled' })}>
                      {t('Switch off')}
                    </Button>
                  )}
                  {u.status === 'disabled' && (
                    <Button type="button" size="sm" variant="outline" onClick={() => update.mutate({ id: u.id, status: 'active' })}>
                      {t('Switch on')}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => { if (window.confirm(t('Remove portal access for {name}? Their messages and requests stay.', { name: u.name }))) remove.mutate(u.id); }}>
                    {t('Remove')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite &&
        (inviting ? (
          <InviteForm
            companyId={companyId}
            onDone={(r) => {
              setInviting(false);
              if (r) {
                setLink(r);
                onChange();
              }
            }}
          />
        ) : (
          <Button type="button" size="sm" onClick={() => setInviting(true)}>
            {t('Invite to portal')}
          </Button>
        ))}
    </div>
  );
}

function InviteLink({ url, emailed, name, onClose }: { url: string; emailed: boolean; name: string; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p>{emailed ? t('We emailed {name} an invitation. You can also share this link, which works for 7 days:', { name }) : t('Email is not set up for this workspace, so send {name} this link yourself. It works for 7 days:', { name })}</p>
      <div className="flex gap-2">
        <Input readOnly value={url} aria-label={t('Invitation link')} className="font-mono text-xs" />
        <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
          <Copy aria-hidden /> {copied ? t('Copied') : t('Copy')}
        </Button>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>
        {t('Done')}
      </Button>
    </div>
  );
}

function InviteForm({ companyId, onDone }: { companyId: string; onDone: (r: { url: string; emailed: boolean; name: string } | null) => void }) {
  const t = useT();
  const contacts = useRecordList<ContactRow>('contacts', { companyId, pageSize: 50, sort: 'firstName', order: 'asc' });
  const [v, setV] = useState({ contactId: '', name: '', email: '', role: 'viewer' as PortalRole });
  const [error, setError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: (body: object) => api<{ inviteUrl: string; emailed: boolean; user: PortalUserRow }>('/portal/users', { method: 'POST', json: body }),
    onSuccess: (r) => onDone({ url: r.inviteUrl, emailed: r.emailed, name: r.user.name }),
  });
  const withEmail = contacts.data?.items.filter((c) => c.email) ?? [];
  return (
    <form
      className="space-y-3 rounded-md border border-border p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const body = { companyId, contactId: v.contactId || undefined, name: v.name, email: v.email, role: v.role };
        const r = portalInviteSchema.safeParse(body);
        if (!r.success) return setError(t.maybe(r.error.issues[0]!.message));
        setError(null);
        invite.mutate(r.data);
      }}
    >
      {withEmail.length > 0 && (
        <Field id="pi-contact" label={t('Contact')} hint={t('Pick a contact to fill in their name and email, or type them below.')}>
          <Select
            id="pi-contact"
            value={v.contactId}
            onChange={(e) => {
              const c = withEmail.find((x) => x.id === e.target.value);
              setV({ ...v, contactId: e.target.value, ...(c ? { name: [c.firstName, c.lastName].filter(Boolean).join(' '), email: c.email ?? '' } : {}) });
            }}
          >
            <option value="">{t('Someone else')}</option>
            {withEmail.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(' ')} ({c.email})
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="pi-name" label={t('Name')}>
          <Input id="pi-name" value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field id="pi-email" label={t('Email')}>
          <Input id="pi-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
      </div>
      <Field id="pi-role" label={t('Access')}>
        <Select id="pi-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as PortalRole })}>
          {PORTAL_ROLES.map((r) => (
            <option key={r} value={r}>
              {t.maybe(PORTAL_ROLE_LABELS[r])}
            </option>
          ))}
        </Select>
      </Field>
      {(error || invite.error) && <p role="alert" className="text-sm text-critical">{error ?? invite.error?.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={invite.isPending}>
          {t('Send invitation')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onDone(null)}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}
