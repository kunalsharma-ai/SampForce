'use client';

import {
  ORG_CREDENTIAL_ACCESS,
  ORG_CREDENTIAL_ACCESS_LABELS,
  ORG_CREDENTIAL_KIND_LABELS,
  ORG_CREDENTIAL_KINDS,
  type OrgAccess,
  type OrgCredentialAccess,
  type OrgCredentialKind,
  type OrgCredentialRow,
  type OrgCredentialSecret,
} from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { ExternalLink, Eye, EyeOff, KeyRound, Lock, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ConfirmDeletionDialog } from '@/components/security/confirm-deletion-dialog';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useOrgCredentials, useOrgMutations } from '@/lib/my-organization';
import { CopyButton, EmptyState, formatWhen } from './parts';

/** How long a revealed secret stays on screen before it is hidden again. */
const REVEAL_SECONDS = 60;

/**
 * Credentials (ADR 0100): portal logins, membership IDs, licence numbers. Restricted to the Super and Manager
 * Workspaces, stored sealed, shown only after a password check, never shared with clients.
 */
export function CredentialsPanel({ access }: { access: OrgAccess }) {
  const t = useT();
  const list = useOrgCredentials(access.canSeeCredentials);
  const [editing, setEditing] = React.useState<OrgCredentialRow | 'new' | null>(null);
  const rows = list.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-semibold">{t('Kept sealed and never shared with clients')}</p>
            <p className="text-muted-foreground">{t('Secrets are encrypted. Each reveal asks for your password and is written to the activity history.')}</p>
          </div>
        </div>
        {access.canManageCredentials && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> {t('Add credential')}
          </Button>
        )}
      </div>
      {list.isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" aria-busy />
      ) : list.isError ? (
        <p className="rounded-xl border border-critical/40 bg-critical/5 p-4 text-sm">{t('Could not load the credentials. Refresh to try again.')}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('No credentials yet')}
          text={t('Keep portal logins, tax portal access, membership IDs and licence numbers here instead of in chats and spreadsheets.')}
          action={
            access.canManageCredentials ? (
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" aria-hidden /> {t('Add the first credential')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <CredentialCard key={c.id} c={c} access={access} onEdit={() => setEditing(c)} />
          ))}
        </ul>
      )}
      {access.canManageCredentials && <CredentialDialog value={editing} access={access} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CredentialCard({ c, access, onEdit }: { c: OrgCredentialRow; access: OrgAccess; onEdit: () => void }) {
  const t = useT();
  const { reveal, removeCredential } = useOrgMutations();
  const [asking, setAsking] = React.useState<'reveal' | 'delete' | null>(null);
  const [secret, setSecret] = React.useState<OrgCredentialSecret | null>(null);
  const [left, setLeft] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!secret) return;
    if (left <= 0) {
      setSecret(null);
      return;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [secret, left]);

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm" data-credential={c.label}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold">{c.label}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t.maybe(ORG_CREDENTIAL_KIND_LABELS[c.kind])}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden />
              {t.maybe(ORG_CREDENTIAL_ACCESS_LABELS[c.access])}
            </span>
          </p>
        </div>
        {access.canManageCredentials && (
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={onEdit} aria-label={t('Edit {label}', { label: c.label })} title={t('Edit')} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
              <Pencil className="size-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setAsking('delete')} aria-label={t('Delete {label}', { label: c.label })} title={t('Delete')} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-critical/10 hover:text-critical">
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
      <dl className="space-y-2 text-sm">
        {c.url && (
          <Row label={t('Website')}>
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline">
              <span className="truncate">{c.url.replace(/^https?:\/\//, '')}</span>
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          </Row>
        )}
        {c.username && (
          <Row label={t('Username or ID')} copy={c.username}>
            <span className="truncate font-mono text-[0.8rem]">{c.username}</span>
          </Row>
        )}
        {c.hasSecret && (
          <Row label={t('Password or secret')} copy={secret?.secret ?? undefined}>
            <span className={cn('truncate font-mono text-[0.8rem]', !secret && 'tracking-widest text-muted-foreground')}>{secret?.secret ?? '••••••••••'}</span>
          </Row>
        )}
        {secret?.notes && (
          <div className="rounded-lg bg-muted/60 p-2.5 text-xs">
            <p className="mb-0.5 font-medium text-muted-foreground">{t('Notes')}</p>
            <p className="whitespace-pre-line">{secret.notes}</p>
          </div>
        )}
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{c.lastRevealedAt ? t('Last revealed {when}', { when: formatWhen(c.lastRevealedAt, t.formatLocale) }) : t('Never revealed')}</span>
        {(c.hasSecret || c.hasNotes) &&
          (secret ? (
            <Button size="sm" variant="outline" onClick={() => setSecret(null)}>
              <EyeOff className="size-4" aria-hidden /> {t('Hide ({seconds}s)', { seconds: left })}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAsking('reveal')} disabled={reveal.isPending}>
              <Eye className="size-4" aria-hidden /> {t('Reveal')}
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <ConfirmDeletionDialog
        open={asking !== null}
        title={asking === 'reveal' ? t('Reveal this credential?') : t('Delete this credential?')}
        description={asking === 'reveal' ? t('The reveal of “{label}” is written to the activity history.', { label: c.label }) : t('“{label}” will be deleted for every workspace.', { label: c.label })}
        confirmLabel={asking === 'reveal' ? t('Reveal') : undefined}
        onCancel={() => setAsking(null)}
        onConfirmed={async (pass) => {
          const what = asking;
          setAsking(null);
          setError(null);
          try {
            if (what === 'reveal') {
              setSecret(await reveal.mutateAsync({ id: c.id, pass }));
              setLeft(REVEAL_SECONDS);
            } else {
              await removeCredential.mutateAsync({ id: c.id, pass });
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </li>
  );
}

function Row({ label, copy, children }: { label: string; copy?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <dt className="w-32 shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center justify-between gap-2">
        {children}
        {copy && <CopyButton value={copy} label={t('Copy {label}', { label })} compact />}
      </dd>
    </div>
  );
}

interface CredForm {
  label: string;
  kind: OrgCredentialKind;
  url: string;
  username: string;
  secret: string;
  notes: string;
  access: OrgCredentialAccess;
  clearSecret: boolean;
}

function CredentialDialog({ value, access, onClose }: { value: OrgCredentialRow | 'new' | null; access: OrgAccess; onClose: () => void }) {
  const t = useT();
  const { addCredential, updateCredential } = useOrgMutations();
  const editing = value && value !== 'new' ? value : null;
  const [f, setF] = React.useState<CredForm>({ label: '', kind: 'portal_login', url: '', username: '', secret: '', notes: '', access: 'MANAGERS', clearSecret: false });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [show, setShow] = React.useState(false);
  const busy = addCredential.isPending || updateCredential.isPending;

  React.useEffect(() => {
    if (!value) return;
    setF(
      editing
        ? { label: editing.label, kind: editing.kind, url: editing.url ?? '', username: editing.username ?? '', secret: '', notes: '', access: editing.access, clearSecret: false }
        : { label: '', kind: 'portal_login', url: '', username: '', secret: '', notes: '', access: access.level === 'SUPER' ? 'SUPER' : 'MANAGERS', clearSecret: false },
    );
    setErrors({});
    setShow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const set = <K extends keyof CredForm>(k: K, v: CredForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.label.trim()) return setErrors({ label: t('Name the credential') });
    const base = { label: f.label.trim(), kind: f.kind, url: f.url.trim() || null, username: f.username.trim() || null, access: f.access };
    try {
      if (editing) {
        await updateCredential.mutateAsync({
          id: editing.id,
          input: { ...base, ...(f.secret ? { secret: f.secret } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}), ...(f.clearSecret && !f.secret ? { clearSecret: true } : {}) },
        });
      } else {
        await addCredential.mutateAsync({ ...base, ...(f.secret ? { secret: f.secret } : {}), notes: f.notes.trim() || null });
      }
      onClose();
    } catch (err) {
      const out: Record<string, string> = {};
      if (err instanceof ApiError) for (const d of err.details ?? []) out[d.path.split('.')[0] ?? ''] ??= d.message;
      setErrors(Object.keys(out).length ? out : { form: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{editing ? t('Edit credential') : t('Add a credential')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{editing ? t('Leave the secret and notes empty to keep what is stored.') : t('The secret and notes are encrypted before they are stored.')}</DialogDescription>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="org-cred-label" label={t('Name *')} error={errors.label}>
              <Input value={f.label} onChange={(e) => set('label', e.target.value)} maxLength={160} placeholder={t('For example, GST portal')} />
            </Field>
          </div>
          <Field id="org-cred-kind" label={t('Kind')}>
            <Select value={f.kind} onChange={(e) => set('kind', e.target.value as OrgCredentialKind)}>
              {ORG_CREDENTIAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.maybe(ORG_CREDENTIAL_KIND_LABELS[k])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="org-cred-access" label={t('Who can see it')}>
            <Select value={f.access} onChange={(e) => set('access', e.target.value as OrgCredentialAccess)}>
              {ORG_CREDENTIAL_ACCESS.filter((a) => a !== 'SUPER' || access.level === 'SUPER').map((a) => (
                <option key={a} value={a}>
                  {t.maybe(ORG_CREDENTIAL_ACCESS_LABELS[a])}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field id="org-cred-url" label={t('Website')} error={errors.url}>
              <Input type="url" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="org-cred-username" label={t('Username or ID')} error={errors.username}>
              <Input value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" maxLength={200} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="org-cred-secret" label={t('Password or secret')} hint={editing?.hasSecret ? t('A secret is stored. Type a new one to change it.') : undefined} error={errors.secret}>
              <Input type={show ? 'text' : 'password'} value={f.secret} onChange={(e) => set('secret', e.target.value)} autoComplete="new-password" maxLength={2000} />
            </Field>
            <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              {show ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
              {show ? t('Hide') : t('Show')}
            </button>
            {editing?.hasSecret && !f.secret && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={f.clearSecret} onChange={(e) => set('clearSecret', e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
                {t('Remove the stored secret')}
              </label>
            )}
          </div>
          <div className="sm:col-span-2">
            <Field id="org-cred-notes" label={t('Notes')} hint={editing?.hasNotes ? t('Notes are stored. Type new notes to replace them.') : undefined} error={errors.notes}>
              <Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
            </Field>
          </div>
          {errors.form && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {errors.form}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('Saving…') : editing ? t('Save changes') : t('Add credential')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
