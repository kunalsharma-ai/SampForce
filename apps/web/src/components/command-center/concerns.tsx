'use client';

import { CONCERN_CATEGORIES, CONCERN_SEVERITIES, type ClientConcernRow } from '@dealflow/types';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Skeleton,
} from '@dealflow/ui';
import { ArrowUpRight, CircleCheck, MessageSquareWarning, Pencil } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useCompanyAction } from '@/components/crm/company-actions';
import { PersonSelect } from '@/components/crm/lead-fields';
import { InfoTip } from '@/components/info-tip';
import { useHasFeature } from '@/lib/features';
import { useCan } from '@/lib/session';
import { Select, Textarea } from '@/components/crm/select';
import { useClientConcerns, useConcernMutations } from '@/lib/command-center';
import { useCompanyEmployees } from '@/lib/company-work';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { CONCERN_CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE } from './cc-labels';

/**
 * Client concerns and rejections (ADR 0063, spec section 19): raised on a company, worked by its owner and manager,
 * escalated up the reporting lines when needed, and resolved with final remarks.
 */

/** The `date` input value of a deadline, in the browser's time zone. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Raise a concern on a company (company page quick action). With `editing`, changes that concern instead: its
 * category, title, description, severity, employee, owner and deadline (ADR 0065).
 */
export function RaiseConcernDialog({
  company,
  employees: given,
  editing,
  onClose,
}: {
  company: { id: string; name: string };
  employees?: { id: string; name: string }[];
  editing?: ClientConcernRow;
  onClose: () => void;
}) {
  const t = useT();
  const { raise, update } = useConcernMutations();
  const loaded = useCompanyEmployees(company.id);
  const employees = given ?? loaded.data ?? [];
  const [form, setForm] = React.useState({
    category: (editing?.category ?? 'GENERAL') as (typeof CONCERN_CATEGORIES)[number],
    title: editing?.title ?? '',
    description: editing?.description ?? '',
    severity: (editing?.severity ?? 'MEDIUM') as (typeof CONCERN_SEVERITIES)[number],
    contactId: editing?.contact?.id ?? '',
    ownerId: editing?.owner?.id ?? '',
    deadline: toDateInput(editing?.deadlineAt ?? null),
  });
  const [error, setError] = React.useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError(t('Enter a short title.'));
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          input: {
            category: form.category,
            title: form.title.trim(),
            description: form.description.trim() || null,
            severity: form.severity,
            contactId: form.contactId || null,
            // An empty owner keeps the current one.
            ...(form.ownerId ? { ownerId: form.ownerId } : {}),
            deadlineAt: form.deadline ? new Date(`${form.deadline}T17:00:00`).toISOString() : null,
          },
        });
        onClose();
        return;
      }
      await raise.mutateAsync({
        companyId: company.id,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim() || null,
        severity: form.severity,
        contactId: form.contactId || null,
        ownerId: form.ownerId || null,
        deadlineAt: form.deadline ? new Date(`${form.deadline}T17:00:00`).toISOString() : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{editing ? t('Edit client concern') : t('Raise a client concern')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('For {company}. The owner and their manager are notified.', { company: company.name })}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cc-cat" label={t('Concern category')}>
              <Select value={form.category} onChange={(e) => set({ category: e.target.value as typeof form.category })}>
                {CONCERN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(CONCERN_CATEGORY_LABEL[c])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cc-sev" label={t('Severity')}>
              <Select value={form.severity} onChange={(e) => set({ severity: e.target.value as typeof form.severity })}>
                {CONCERN_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(SEVERITY_LABEL[s])}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="cc-title" label={t('Title')}>
            <Input maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field id="cc-desc" label={t('Description')}>
            <Textarea rows={3} maxLength={5000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="cc-contact" label={t('Employee (optional)')}>
              <Select value={form.contactId} onChange={(e) => set({ contactId: e.target.value })}>
                <option value="">{t('None')}</option>
                {employees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cc-deadline" label={t('Resolution deadline')}>
              <Input type="date" value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} />
            </Field>
          </div>
          <Field id="cc-owner" label={t('Assigned owner (optional)')}>
            <PersonSelect value={form.ownerId} onChange={(ownerId) => set({ ownerId })} placeholder={t('The company owner')} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={raise.isPending || update.isPending}>
              {raise.isPending || update.isPending ? t('Saving…') : editing ? t('Save changes') : t('Raise concern')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Concerns in a box, with escalation and resolution. */
export function ConcernList({
  box,
  companyId,
  emptyText,
}: {
  box: 'mine' | 'team' | 'escalated';
  companyId?: string;
  emptyText: string;
}) {
  const t = useT();
  const q = useClientConcerns(box, { companyId });
  const [escalating, setEscalating] = React.useState<ClientConcernRow | null>(null);
  const [resolving, setResolving] = React.useState<ClientConcernRow | null>(null);
  const [editing, setEditing] = React.useState<ClientConcernRow | null>(null);
  if (q.isPending) return <Skeleton className="h-20" />;
  if (q.error) return <p role="alert" className="text-sm text-critical">{q.error.message}</p>;
  if (!q.data?.length) return <p className="p-2 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <>
      <ul className="divide-y divide-border" data-testid={`concerns-${box}`}>
        {q.data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{c.title}</p>
              {!companyId && (
                <Link href={`/app/companies/${c.company.id}`} className="text-xs text-primary hover:underline">
                  {[c.company.leadNumber, c.company.name].filter(Boolean).join(' ')}
                </Link>
              )}
              <p className="text-xs text-muted-foreground">
                {[
                  t(CONCERN_CATEGORY_LABEL[c.category]),
                  c.contact?.name,
                  c.owner && t('Owner: {name}', { name: c.owner.name }),
                  c.manager && t('Manager: {name}', { name: c.manager.name }),
                  c.deadlineAt && t('Resolve by {date}', { date: formatDate(c.deadlineAt) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {c.escalatedTo && (
                <p className="text-xs font-medium">
                  {t('Escalated to {name}', { name: c.escalatedTo.name })}
                  {c.escalationNote ? `: ${c.escalationNote}` : ''}
                </p>
              )}
              {c.resolution && <p className="mt-1 text-xs">{t('Resolution: {text}', { text: c.resolution })}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge tone={SEVERITY_TONE[c.severity]}>{t(SEVERITY_LABEL[c.severity])}</Badge>
              {c.overdue && <Badge tone="critical">{t('Overdue')}</Badge>}
              {c.status === 'RESOLVED' && <Badge tone="success">{t('Resolved')}</Badge>}
              {c.canEscalate && (
                <Button size="sm" variant="outline" onClick={() => setEscalating(c)}>
                  <ArrowUpRight aria-hidden /> {t('Escalate')}
                </Button>
              )}
              {c.canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={t('Edit “{subject}”', { subject: c.title })}>
                  <Pencil aria-hidden />
                </Button>
              )}
              {c.canEdit && (
                <Button size="sm" onClick={() => setResolving(c)}>
                  <CircleCheck aria-hidden /> {t('Resolve')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {escalating && <EscalateDialog row={escalating} onClose={() => setEscalating(null)} />}
      {resolving && <ResolveDialog row={resolving} onClose={() => setResolving(null)} />}
      {editing && <RaiseConcernDialog company={editing.company} editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** The concern list in a card (manager dashboard and company page). */
export function ConcernsCard({ box, companyId }: { box: 'mine' | 'team' | 'escalated'; companyId?: string }) {
  const t = useT();
  return (
    <Card className="p-3">
      <ConcernList box={box} companyId={companyId} emptyText={t('No unresolved client concerns.')} />
    </Card>
  );
}

/** The concerns of one company, and Raise concern (company page). */
export function CompanyConcerns({
  company,
  employees,
}: {
  company: { id: string; name: string; restricted?: boolean };
  employees: { id: string; name: string }[];
}) {
  const t = useT();
  const on = useHasFeature('client_concerns');
  const canWrite = useCan('companies:write') && !company.restricted;
  const [raising, setRaising] = React.useState(false);
  useCompanyAction('raiseConcern', on && canWrite ? () => setRaising(true) : null);
  if (!on) return null;
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {t('Client concerns')}
          <InfoTip topic="cc.concerns" />
        </h2>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => setRaising(true)}>
            <MessageSquareWarning aria-hidden /> {t('Raise concern')}
          </Button>
        )}
      </div>
      <div className="p-2">
        <ConcernList box="mine" companyId={company.id} emptyText={t('No open concerns for this company.')} />
      </div>
      {raising && <RaiseConcernDialog company={company} employees={employees} onClose={() => setRaising(false)} />}
    </Card>
  );
}

export function EscalateDialog({ row, onClose }: { row: { id: string; title: string }; onClose: () => void }) {
  const t = useT();
  const { escalate } = useConcernMutations();
  const [to, setTo] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await escalate.mutateAsync({ id: row.id, toUserId: to || null, note: note.trim() || null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Escalate to senior management')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{row.title}</DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="esc-to" label={t('Escalate to')}>
            <PersonSelect value={to} onChange={setTo} placeholder={t('The next person up the reporting lines')} />
          </Field>
          <Field id="esc-note" label={t('Note')} error={error ?? undefined}>
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={escalate.isPending}>
              {escalate.isPending ? t('Saving…') : t('Escalate')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({ row, onClose }: { row: ClientConcernRow; onClose: () => void }) {
  const t = useT();
  const { resolve } = useConcernMutations();
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError(t('Describe how it was resolved.'));
    try {
      await resolve.mutateAsync({ id: row.id, resolution: text.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Resolve the concern')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{row.title}</DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="res-text" label={t('Final remarks')} error={error ?? undefined}>
            <Textarea rows={4} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={resolve.isPending}>
              {resolve.isPending ? t('Saving…') : t('Resolve')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
