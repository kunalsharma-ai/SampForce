'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { DEFAULT_EVENT_RULES, type EmailTemplateRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, titleCase } from '@/lib/crm';
import { pct, SEQUENCE_TONE, useSequences, useSuppressions, useTemplates } from '@/lib/sequences';
import { useCan } from '@/lib/session';
import { insertAt, MergeFieldBar, PreviewPanel } from './merge-fields';

type Tab = 'sequences' | 'templates' | 'suppressions';

export function SequencesWorkspace() {
  const [tab, setTab] = useState<Tab>('sequences');
  return (
    <div>
      <Tabs<Tab>
        label="Email sequences"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'sequences', label: 'Sequences' },
          { key: 'templates', label: 'Templates' },
          { key: 'suppressions', label: 'Do-not-email list' },
        ]}
      />
      {tab === 'sequences' && <SequenceList />}
      {tab === 'templates' && <TemplateLibrary />}
      {tab === 'suppressions' && <SuppressionList />}
    </div>
  );
}

function SequenceList() {
  const list = useSequences();
  const canWrite = useCan('sequences:write');
  const router = useRouter();
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/sequences', {
        method: 'POST',
        json: {
          name: 'New sequence',
          steps: [
            { id: 'step-1', type: 'email', delayDays: 0, subject: 'Quick question, {{first_name|there}}', body: 'Hi {{first_name|there}},\n\n\n\n{{sender_first_name}}' },
            { id: 'step-2', type: 'email', delayDays: 3, subject: 'Re: quick question', body: 'Hi {{first_name|there}}, following up on my note above.\n\n{{sender_first_name}}' },
          ],
          rules: DEFAULT_EVENT_RULES,
          settings: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
        },
      }),
    onSuccess: (s) => router.push(`/app/sequences/${s.id}`),
  });
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus aria-hidden /> New sequence
          </Button>
          <ErrorText error={create.error} />
        </div>
      )}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {list.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : list.error ? (
            <div className="p-4">
              <ErrorText error={list.error} />
            </div>
          ) : list.data.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No sequences yet. A sequence sends a few personal emails over days or weeks and stops when someone replies.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Sequence</th>
                  <th className="px-4 py-2 text-right font-medium">Steps</th>
                  <th className="px-4 py-2 text-right font-medium">In progress</th>
                  <th className="px-4 py-2 text-right font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Replied</th>
                  <th className="px-4 py-2 text-right font-medium">Opened*</th>
                  <th className="px-4 py-2 text-right font-medium">Bounced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2">
                      <Link href={`/app/sequences/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>{' '}
                      <Badge tone={SEQUENCE_TONE[s.status]}>{titleCase(s.status)}</Badge>
                      <span className="block text-xs text-muted-foreground">
                        {s.owner ? `By ${s.owner.name} · ` : ''}updated {formatDate(s.updatedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.steps.length}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.stats.active}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.stats.sent}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {s.stats.replied} <span className="text-xs text-muted-foreground">{pct(s.stats.replied, s.stats.sent)}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {s.stats.opened} <span className="text-xs text-muted-foreground">{pct(s.stats.opened, s.stats.sent)}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.stats.bounced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        *Opens are approximate. Apple Mail loads tracking images by itself, and many work inboxes block them, so open counts can be too high or too low. Replies come from your synced mailbox and are reliable.
      </p>
    </div>
  );
}

// ───────────── Templates ─────────────

function TemplateLibrary() {
  const templates = useTemplates();
  const canWrite = useCan('sequences:write');
  const [editing, setEditing] = useState<EmailTemplateRow | 'new' | null>(null);
  return (
    <div className="space-y-4">
      {canWrite && !editing && (
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> New template
        </Button>
      )}
      {editing && <TemplateForm key={editing === 'new' ? 'new' : editing.id} template={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      {templates.isPending ? (
        <Skeleton className="h-24" />
      ) : templates.error ? (
        <ErrorText error={templates.error} />
      ) : templates.data.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">No templates yet. Templates are reusable emails with merge fields such as first name and company.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.data.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {t.name}
                  {t.shared ? <Badge tone="primary">Shared</Badge> : <Badge>Only you</Badge>}
                  {t.usedBy > 0 && <Badge tone="accent">In {t.usedBy} sequence{t.usedBy === 1 ? '' : 's'}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{t.subject}</p>
                <p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">{t.body}</p>
                {canWrite && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateForm({ template, onDone }: { template: EmailTemplateRow | null; onDone: () => void }) {
  const qc = useQueryClient();
  const canShare = useCan('marketing:manage');
  const [v, setV] = useState({ name: template?.name ?? '', subject: template?.subject ?? '', body: template?.body ?? '', shared: template?.shared ?? false });
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const last = useRef<'subject' | 'body'>('body');
  const save = useMutation({
    mutationFn: () => api(template ? `/email-templates/${template.id}` : '/email-templates', { method: template ? 'PUT' : 'POST', json: v }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['email-templates'] });
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/email-templates/${template!.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['email-templates'] });
      onDone();
    },
  });
  // insertAt moves the cursor as a side effect, so call it once here rather than inside a state updater,
  // which React may run more than once.
  const insert = (tag: string) =>
    setV(last.current === 'subject' ? { ...v, subject: insertAt(subjectRef.current, v.subject, tag) } : { ...v, body: insertAt(bodyRef.current, v.body, tag) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{template ? `Edit ${template.name}` : 'New template'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field id="tpl-name" label="Name">
            <Input id="tpl-name" required maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field id="tpl-subject" label="Subject">
            <Input id="tpl-subject" ref={subjectRef} required maxLength={200} value={v.subject} onFocus={() => (last.current = 'subject')} onChange={(e) => setV({ ...v, subject: e.target.value })} />
          </Field>
          <Field id="tpl-body" label="Email" hint="Plain text. Links become clickable. An unsubscribe line is added to every sequence email.">
            <Textarea
              id="tpl-body"
              ref={bodyRef}
              required
              rows={9}
              maxLength={20_000}
              value={v.body}
              onFocus={() => (last.current = 'body')}
              onChange={(e) => setV({ ...v, body: e.target.value })}
            />
          </Field>
          <MergeFieldBar onInsert={insert} />
          <p className="text-xs text-muted-foreground">Add a fallback after a bar for fields that may be empty, for example {'{{first_name|there}}'}.</p>
          {canShare && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.shared} onChange={(e) => setV({ ...v, shared: e.target.checked })} /> Share with the whole workspace
            </label>
          )}
          <PreviewPanel subject={v.subject} body={v.body} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              Save template
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            {template && (
              <Button type="button" size="sm" variant="ghost" className="text-critical" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Delete
              </Button>
            )}
          </div>
          <ErrorText error={save.error ?? remove.error} />
        </form>
      </CardContent>
    </Card>
  );
}

// ───────────── Do-not-email list ─────────────

const REASON_LABEL = { UNSUBSCRIBED: 'Unsubscribed', BOUNCED: 'Bounced', MANUAL: 'Added by your team' } as const;

function SuppressionList() {
  const [search, setSearch] = useState('');
  const list = useSuppressions(search);
  const qc = useQueryClient();
  const canWrite = useCan('sequences:write');
  const canManage = useCan('marketing:manage');
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => api<{ added: number }>('/sequences/suppressions', { method: 'POST', json: { emails: text.split(/[\s,;]+/).filter(Boolean) } }),
    onSuccess: async () => {
      setText('');
      await qc.invalidateQueries({ queryKey: ['sequences'] });
    },
  });
  const remove = useMutation({
    mutationFn: (v: { email: string; reason?: string }) => api(`/sequences/suppressions/${encodeURIComponent(v.email)}/remove`, { method: 'POST', json: { reason: v.reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="space-y-3 p-4">
          <Input aria-label="Search addresses" placeholder="Search addresses" value={search} onChange={(e) => setSearch(e.target.value)} />
          {list.isPending ? (
            <Skeleton className="h-24" />
          ) : list.error ? (
            <ErrorText error={list.error} />
          ) : list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is on the list{search ? ' that matches' : ''}.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {list.data.map((s) => (
                <li key={s.email} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{s.email}</span>
                  <Badge tone={s.reason === 'BOUNCED' ? 'critical' : s.reason === 'UNSUBSCRIBED' ? 'warning' : 'neutral'}>{REASON_LABEL[s.reason]}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(s.createdAt)}</span>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => {
                        const reason = s.reason === 'UNSUBSCRIBED' ? window.prompt('This person unsubscribed. Why may they be emailed again?') : undefined;
                        if (s.reason === 'UNSUBSCRIBED' && !reason) return;
                        remove.mutate({ email: s.email, reason: reason ?? undefined });
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={remove.error} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">Sequences never email anyone on this list. Unsubscribes and bounces are added automatically.</p>
          {canWrite && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <label htmlFor="sup-add" className="sr-only">
                Email addresses
              </label>
              <Textarea id="sup-add" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="one@example.com, two@example.com" />
              <Button type="submit" size="sm" disabled={!text.trim() || add.isPending}>
                Add to list
              </Button>
              {add.data && <p role="status" className="text-xs text-success">Added {add.data.added}.</p>}
              <ErrorText error={add.error} />
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
