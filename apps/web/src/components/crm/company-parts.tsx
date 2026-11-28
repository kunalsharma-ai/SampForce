'use client';

import {
  branchInputSchema,
  type BranchRow,
  type CompanyRow,
  contactInputSchema,
  type ContactRow,
  LEAD_TRANSFER_REASONS,
  type LeadTransferReason,
  PORTAL_DOCUMENT_MAX_BYTES,
  PORTAL_DOCUMENT_TYPES,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Check, Download, FileText, Pencil, Plus, Trash2, UserRoundCog, X } from 'lucide-react';
import * as React from 'react';
import { formatBytes, UploadZone } from '@/components/forms/upload-zone';
import { InfoTip } from '@/components/info-tip';
import { api, ApiError } from '@/lib/api';
import { personLabel, useBranches, useBranchMutations, useChangeOwner, useCompanyFileMutations, useCompanyFiles, useOwnerHistory } from '@/lib/company-leads';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { ENTITY_FEATURE, useHasFeature, useCanDelete } from '@/lib/features';
import { useLeadTransfers } from '@/lib/command-center';
import { RequestTransferDialog } from '@/components/command-center/transfers';
import { TRANSFER_STATUS_LABEL, TRANSFER_STATUS_TONE } from '@/components/command-center/cc-labels';
import { BranchFields, branchPayload, type BranchValue, emptyBranch, emptyEmployee, EmployeeFields, employeePayload, type EmployeeValue, type Errors, PersonSelect } from './lead-fields';
import { focusSection, useCompanyAction } from './company-actions';
import { DetailList } from './record-detail';
import { type PickerValue, RecordPicker } from './record-picker';
import { Select, Textarea } from './select';
import { CountryFlag } from './status-chip';

export const REASON_LABELS = {
  REASSIGNED: 'Routine reassignment',
  SENIOR_DISCUSSION: 'Client requires senior-level discussion',
  HIGH_VALUE: 'High-value opportunity',
  NEGOTIATION: 'Commercial negotiation',
  CLIENT_CONCERN: 'Client concern',
  TECHNICAL: 'Technical clarification',
  MANAGEMENT: 'Management intervention',
  OTHER: 'Other',
} as const satisfies Record<LeadTransferReason, MessageKey>;

const issuesToErrors = (issues: { path: PropertyKey[]; message: string }[], say: (m: string) => string): Errors => {
  const out: Errors = {};
  for (const i of issues) {
    const k = i.path.map(String).join('.').replace(/\.value$/, '');
    if (!out[k]) out[k] = say(i.message);
  }
  return out;
};
const apiErrors = (e: unknown, say: (m: string) => string): Errors =>
  e instanceof ApiError && e.details?.length ? Object.fromEntries(e.details.map((d) => [d.path.replace(/\.value$/, ''), say(d.message)])) : {};

// ─── Employees ───

/** "Priya Nair" with her saved addresses and numbers, as the employee form holds them. */
export function employeeValueFrom(c: ContactRow): EmployeeValue {
  const pts = (list: { value: string; primary?: boolean }[], single: string | null) => (list.length ? list.map((p) => ({ value: p.value, primary: !!p.primary })) : [{ value: single ?? '', primary: true }]);
  return {
    key: c.id, firstName: c.firstName, lastName: c.lastName ?? '', linkedinUrl: c.linkedinUrl ?? '', jobTitle: c.jobTitle ?? '', department: c.department ?? '',
    emails: pts(c.emails, c.email), phones: pts(c.phones, c.phone), country: c.country ?? '', state: c.state ?? '', city: c.city ?? '', remarks: c.remarks ?? '',
    statusId: c.status?.id ?? '', nextFollowUpAt: c.nextFollowUpAt ? toDateInput(c.nextFollowUpAt) : '', ownerId: c.ownerPerson?.id ?? c.owner?.id ?? '',
  };
}

/** YYYY-MM-DD in the reader's own time zone. */
const toDateInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Adds an employee to the company, or edits one (`contactId`), without leaving the company page. The employee is a
 * contact like any other: the same record shows under Contacts.
 */
export function AddEmployeeDialog({ company, open, onOpenChange, contactId }: { company: CompanyRow; open: boolean; onOpenChange: (o: boolean) => void; contactId?: string | null }) {
  const t = useT();
  const qc = useQueryClient();
  const editing = !!contactId;
  const [value, setValue] = React.useState<EmployeeValue>(emptyEmployee);
  const [errors, setErrors] = React.useState<Errors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    if (!contactId) {
      setValue({ ...emptyEmployee(), country: company.country ?? '' });
      return;
    }
    let live = true;
    setLoading(true);
    api<ContactRow>(`/contacts/${contactId}`)
      .then((c) => live && setValue(employeeValueFrom(c)))
      .catch((err: Error) => live && setFormError(err.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, company.country, contactId]);
  // Deleting one employee lives here, behind Edit, so it is never pressed by mistake on the list (ADR 0097).
  const mayWrite = useCan('contacts:write');
  const mayDelete = useCanDelete(ENTITY_FEATURE.contacts);
  const [askDelete, setAskDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  React.useEffect(() => {
    if (open) setAskDelete(false);
  }, [open]);
  const removeEmployee = async () => {
    if (!contactId) return;
    setDeleting(true);
    setFormError(null);
    try {
      await api(`/contacts/${contactId}`, { method: 'DELETE' });
      await Promise.all(['contacts', 'company-employees', 'company-dashboard', 'companies'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onOpenChange(false);
    } catch (err) {
      // A cancelled password, or a request sent to a manager for approval, is shown as a note.
      setFormError(err instanceof Error ? t.maybe(err.message) : t('Could not delete this record.'));
      setAskDelete(false);
    } finally {
      setDeleting(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...employeePayload(value), companyId: company.id, ownerId: value.ownerId || company.ownerPerson?.id || null };
    const parsed = contactInputSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t.maybe));
      requestAnimationFrame(() => (document.querySelector('[role="dialog"] [aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api(editing ? `/contacts/${contactId}` : '/contacts', { method: editing ? 'PATCH' : 'POST', json: body });
      await Promise.all([qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['company-employees'] }), qc.invalidateQueries({ queryKey: ['company-dashboard'] }), qc.invalidateQueries({ queryKey: ['companies'] })]);
      onOpenChange(false);
    } catch (err) {
      setErrors(apiErrors(err, t.maybe));
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{editing ? t('Edit employee / POC') : t('Add employee / POC')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('At {company}. Fields marked * are required.', { company: company.name })}</DialogDescription>
        {loading ? (
          <Skeleton className="h-64" />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <EmployeeFields idPrefix={editing ? 'edit-employee' : 'add-employee'} value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} errors={errors} />
            {formError && (
              <p role="alert" className="text-sm text-critical">
                {formError}
              </p>
            )}
            {askDelete && (
              <div role="alert" className="space-y-2 rounded-md border border-critical/40 bg-critical/5 p-3 text-sm">
                <p className="font-medium">{t('Delete this employee?')}</p>
                <p className="text-muted-foreground">
                  {t('This deletes the contact records themselves, with their details. To keep a person but take them off this company, use Remove from company instead.')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="destructive" disabled={deleting} onClick={() => void removeEmployee()}>
                    <Trash2 aria-hidden /> {deleting ? t('Deleting…') : t('Delete employee')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={deleting} onClick={() => setAskDelete(false)}>
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {editing && mayWrite && mayDelete && !company.restricted && !askDelete && (
                <Button type="button" variant="ghost" className="me-auto text-critical" onClick={() => setAskDelete(true)}>
                  <Trash2 aria-hidden /> {t('Delete employee')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('Saving…') : editing ? t('Save changes') : t('Add employee')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Moves a contact that is already in SampForce (with no company, or at another one) to this company. */
export function LinkContactDialog({ company, open, onOpenChange }: { company: CompanyRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [picked, setPicked] = React.useState<PickerValue | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setPicked(null);
      setError(null);
    }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/contacts/${picked.id}`, { method: 'PATCH', json: { companyId: company.id } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['company-employees'] }), qc.invalidateQueries({ queryKey: ['company-dashboard'] }), qc.invalidateQueries({ queryKey: ['companies'] })]);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{t('Add an existing contact')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('The contact moves to {company} and shows in its employee list.', { company: company.name })}</DialogDescription>
        <form onSubmit={save} className="space-y-4">
          <Field id="link-contact" label={t('Contact')}>
            <RecordPicker id="link-contact" entity="contacts" value={picked} onChange={setPicked} placeholder={t('Search contacts by name or email')} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!picked || saving}>
              {saving ? t('Saving…') : t('Add to company')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Branches ───

export function CompanyBranches({ company }: { company: CompanyRow }) {
  const t = useT();
  const canWrite = useCan('companies:write') && !company.restricted;
  const mayDelete = useCanDelete('account_management');
  const branches = useBranches(company.id);
  const { save, remove } = useBranchMutations(company.id);
  const [editing, setEditing] = React.useState<BranchValue | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Errors>({});
  useCompanyAction('addBranch', canWrite ? () => open(null) : null);
  const open = (row: BranchRow | null) => {
    setErrors({});
    setEditId(row?.id ?? null);
    setEditing(
      row
        ? { key: row.id, name: row.name, country: row.country ?? '', state: row.state ?? '', city: row.city ?? '', address: row.address ?? '', postalCode: row.postalCode ?? '', email: row.email ?? '', phone: row.phone ?? '', contactPerson: row.contactPerson ?? '', website: row.website ?? '' }
        : { ...emptyBranch(), country: company.country ?? '' },
    );
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const parsed = branchInputSchema.safeParse(branchPayload(editing));
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues, t.maybe));
      return;
    }
    try {
      await save.mutateAsync({ id: editId, input: parsed.data });
      setEditing(null);
    } catch (err) {
      setErrors(apiErrors(err, t.maybe));
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Branches')} {branches.data ? <span className="text-muted-foreground">({branches.data.length})</span> : null}
        </CardTitle>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => open(null)}>
            <Plus aria-hidden /> {t('Add branch')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {branches.isPending ? (
          <Skeleton className="h-12" />
        ) : !branches.data?.length ? (
          <p className="text-sm text-muted-foreground">{t('No branches recorded.')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label={t('Branches')}>
            {branches.data.map((b) => (
              <li key={b.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 font-medium">{b.name}</p>
                  {canWrite && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => open(b)} aria-label={t('Edit {name}', { name: b.name })}>
                        <Pencil aria-hidden />
                      </Button>
                      {mayDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => window.confirm(t('Remove the branch {name}?', { name: b.name })) && remove.mutate(b.id)}
                          aria-label={t('Remove {value}', { value: b.name })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {b.country && (
                  <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                    <CountryFlag code={b.country} withName />
                    {(b.city || b.state) && <span>· {[b.city, b.state].filter(Boolean).join(', ')}</span>}
                  </p>
                )}
                {b.address && <p className="text-muted-foreground">{[b.address, b.postalCode].filter(Boolean).join(', ')}</p>}
                <p className="flex flex-wrap gap-x-3 text-muted-foreground">
                  {b.contactPerson && <span>{b.contactPerson}</span>}
                  {b.email && <a className="text-primary hover:underline" href={`mailto:${b.email}`}>{b.email}</a>}
                  {b.phone && <a className="hover:underline" href={`tel:${b.phone}`}>{b.phone}</a>}
                  {b.website && <a className="text-primary hover:underline" href={b.website} target="_blank" rel="noopener noreferrer">{b.website.replace(/^https?:\/\/(www\.)?/, '')}</a>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
          <DialogTitle className="text-lg font-semibold">{editId ? t('Edit branch') : t('Add branch')}</DialogTitle>
          <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('Branches stay linked to {company}.', { company: company.name })}</DialogDescription>
          {editing && (
            <form onSubmit={submit} noValidate className="space-y-4">
              <BranchFields idPrefix="branch" value={editing} onChange={(p) => setEditing((v) => (v ? { ...v, ...p } : v))} errors={errors} />
              {save.error && !Object.keys(errors).length && (
                <p role="alert" className="text-sm text-critical">
                  {save.error.message}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t('Cancel')}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? t('Saving…') : t('Save branch')}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Ownership ───

/** Creator, owner, manager and POC, the change history, and "Change owner" with a reason. */
export function CompanyOwnership({ company: c }: { company: CompanyRow }) {
  const t = useT();
  const canWrite = useCan('companies:write');
  const history = useOwnerHistory(c.id);
  const change = useChangeOwner(c.id);
  const [open, setOpen] = React.useState(false);
  const [ownerId, setOwnerId] = React.useState('');
  const [reason, setReason] = React.useState<LeadTransferReason>('REASSIGNED');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  useCompanyAction('transfer', canWrite ? () => start() : null);
  const transfersOn = useHasFeature('lead_transfers');
  const [asking, setAsking] = React.useState(false);
  const transfers = useLeadTransfers('all', { companyId: c.id }, transfersOn && canWrite);
  useCompanyAction('requestTransfer', transfersOn && canWrite ? () => setAsking(true) : null);
  const start = () => {
    setOwnerId('');
    setReason('REASSIGNED');
    setNote('');
    setError(null);
    setOpen(true);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerId) {
      setError(t('Choose the new owner.'));
      return;
    }
    try {
      await change.mutateAsync({ ownerId, reason, note: note || null });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Company ownership')}
          <InfoTip topic="crm.ownership" />
        </CardTitle>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {transfersOn && (
              <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
                <ArrowRightLeft aria-hidden /> {t('Request transfer')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={start}>
              <UserRoundCog aria-hidden /> {t('Change owner')}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailList
          items={[
            ['Company created by', personLabel(c.createdBy) || null],
            ['Company owner', personLabel(c.ownerPerson) || null],
            ['Assigned manager', personLabel(c.manager) || null],
            ['POC name', personLabel(c.poc) || null],
            ['Assigned department', c.department && t.maybe(c.department.name)],
            ['Assigned team', c.team?.name],
          ]}
        />
        {!!transfers.data?.length && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('Transfer requests')}</h3>
            <ul className="space-y-2 text-sm" data-testid="company-transfers">
              {transfers.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t(REASON_LABELS[r.reason as LeadTransferReason] ?? 'Other')}
                    <span className="text-xs text-muted-foreground"> · {[r.requestedBy?.name, formatDate(r.createdAt)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Badge tone={TRANSFER_STATUS_TONE[r.status]}>{t(TRANSFER_STATUS_LABEL[r.status])}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('Ownership history')}</h3>
          {history.isPending ? (
            <Skeleton className="h-10" />
          ) : !history.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('No changes recorded yet.')}</p>
          ) : (
            <ol className="space-y-2 border-s border-border ps-4 text-sm" aria-label={t('Ownership history')}>
              {history.data.map((h) => (
                <li key={h.id}>
                  <p>
                    {h.from
                      ? t('{from} to {to}', { from: h.from.name, to: h.to?.name ?? t('nobody') })
                      : t('First assigned to {to}', { to: h.to?.name ?? t('nobody') })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[h.by && t('by {name}', { name: h.by.name }), formatDate(h.createdAt), relativeTime(h.createdAt), h.from && h.reason && t(REASON_LABELS[h.reason])].filter(Boolean).join(' · ')}
                  </p>
                  {h.note && <p className="text-xs">“{h.note}”</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
      {transfersOn && canWrite && <RequestTransferDialog company={c} open={asking} onClose={() => setAsking(false)} />}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-6">
          <DialogTitle className="text-lg font-semibold">{t('Change company owner')}</DialogTitle>
          <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('{name} keeps being shown as the creator. The new owner is notified.', { name: c.createdBy?.name ?? t('The creator') })}</DialogDescription>
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field id="owner-new" label={t('New owner')} error={error ?? undefined}>
              <PersonSelect assignableOnly value={ownerId} onChange={setOwnerId} />
            </Field>
            <Field id="owner-reason" label={t('Reason')}>
              <Select value={reason} onChange={(e) => setReason(e.target.value as LeadTransferReason)}>
                {LEAD_TRANSFER_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(REASON_LABELS[r])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="owner-note" label={t('Note for the new owner')}>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending ? t('Saving…') : t('Change owner')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Files ───

export function CompanyFiles({ company }: { company: CompanyRow }) {
  const t = useT();
  const canWrite = useCan('companies:write') && !company.restricted;
  const files = useCompanyFiles(company.id);
  const mayDelete = useCanDelete('account_management');
  const { upload, remove, rename } = useCompanyFileMutations(company.id);
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming?.name.trim()) return;
    try {
      await rename.mutateAsync({ id: renaming.id, name: renaming.name.trim() });
      setRenaming(null);
    } catch {
      // Shown below from rename.error.
    }
  };
  useCompanyAction('upload', canWrite ? () => focusSection('company-files', 'input[type="file"], button') : null);
  if (company.restricted) return null;
  return (
    <Card id="company-files">
      <CardHeader>
        <CardTitle className="text-base">
          {t('Attachments')} {files.data ? <span className="text-muted-foreground">({files.data.length})</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {files.data && files.data.length > 0 && (
          <ul className="divide-y divide-border" aria-label={t('Attachments')}>
            {files.data.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <FileText aria-hidden className="size-4 text-muted-foreground" />
                {renaming?.id === f.id ? (
                  <form onSubmit={saveName} className="flex min-w-0 flex-1 items-center gap-1">
                    <label htmlFor={`file-name-${f.id}`} className="sr-only">
                      {t('File name')}
                    </label>
                    <Input id={`file-name-${f.id}`} autoFocus className="h-8" maxLength={200} value={renaming.name} onChange={(e) => setRenaming({ id: f.id, name: e.target.value })} />
                    <Button type="submit" size="sm" variant="ghost" disabled={!renaming.name.trim() || rename.isPending} aria-label={t('Save file name')}>
                      <Check aria-hidden />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)} aria-label={t('Cancel')}>
                      <X aria-hidden />
                    </Button>
                  </form>
                ) : (
                  <span className="min-w-0 flex-1">
                    <a className="block truncate text-primary hover:underline" href={`/api/v1/company-files/${f.id}/download`}>
                      {f.name}
                    </a>
                    <span className="block text-xs text-muted-foreground">
                      {formatBytes(f.sizeBytes)} · {f.uploadedBy?.name} · {formatDate(f.createdAt)}
                    </span>
                  </span>
                )}
                <Button asChild size="sm" variant="ghost">
                  <a href={`/api/v1/company-files/${f.id}/download`} aria-label={t('Download {name}', { name: f.name })}>
                    <Download aria-hidden />
                  </a>
                </Button>
                {canWrite && renaming?.id !== f.id && (
                  <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: f.id, name: f.name })} aria-label={t('Rename {name}', { name: f.name })}>
                    <Pencil aria-hidden />
                  </Button>
                )}
                {canWrite && mayDelete && (
                  <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => window.confirm(t('Delete {name}?', { name: f.name })) && remove.mutate(f.id)} aria-label={t('Delete {name}', { name: f.name })}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {files.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('No files yet.')}</p>}
        {canWrite && (
          <UploadZone
            label={t('Add a file')}
            accept={[...PORTAL_DOCUMENT_TYPES]}
            maxBytes={PORTAL_DOCUMENT_MAX_BYTES}
            busy={upload.isPending}
            onFile={(f) => upload.mutate(f)}
            hint={t('Kept for your team; not shared in the client portal. Up to 10 MB.')}
          />
        )}
        {(upload.error || rename.error) && (
          <p role="alert" className="text-sm text-critical">
            {(upload.error ?? rename.error)?.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
