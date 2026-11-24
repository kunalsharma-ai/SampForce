'use client';

import { useCanDelete } from '@/lib/features';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { PERMISSIONS, type RoleRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useBilling, useRoles } from '@/lib/billing';
import { useCan, useSession } from '@/lib/session';
import { type MessageKey, useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';
import { useSetRoleVisibility } from '@/lib/company-crm';

/** Permissions grouped by resource, for the role editor. */
const GROUPS = PERMISSIONS.reduce<Record<string, string[]>>((acc, p) => {
  const [res] = p.split(':') as [string];
  (acc[res] ??= []).push(p);
  return acc;
}, {});

const label = (res: string) => res.charAt(0).toUpperCase() + res.slice(1);

export function RolesManager() {
  const t = useT();
  const roles = useRoles();
  const canManage = useCan('members:manage');
  const billing = useBilling(useCan('billing:read'));
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const included = billing.data ? billing.data.features.includes('custom_roles') : undefined;

  return (
    <Card id="roles" className="scroll-mt-20">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <CardTitle>{t('Roles')}</CardTitle>
            <InfoTip topic="team.roles" />
          </div>
          <CardDescription>
            {included === false ? t('System roles are fixed. Custom roles are not included in your plan. You can only grant permissions your own role has.') : t('System roles are fixed. Custom roles combine individual permissions. You can only grant permissions your own role has.')}
          </CardDescription>
        </div>
        {canManage && included !== false && editing === null && (
          <Button size="sm" onClick={() => setEditing('new')}>
            {t('New custom role')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing && <RoleEditor role={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
        <ul className="grid gap-3 md:grid-cols-2">
          {roles.data?.map((r) => (
            <li key={r.key} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <p className="font-medium">{r.name}</p>
                <Badge tone={r.isSystem ? 'neutral' : 'accent'}>{r.isSystem ? t('System') : t('Custom')}</Badge>
                <span className="ms-auto text-xs text-muted-foreground">
                  {t.plural('count.members', r.members)}
                </span>
              </div>
              {r.description && <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>}
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t.plural('count.permissions', r.permissions.length)}</summary>
                <p className="mt-1 leading-relaxed">{r.permissions.join(', ')}</p>
              </details>
              <RoleVisibility role={r} canManage={canManage} />
              {canManage && !r.isSystem && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditing(r)}>
                  {t('Edit')}<span className="sr-only"> {r.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RoleEditor({ role, onDone }: { role: RoleRow | null; onDone: () => void }) {
  const mayDelete = useCanDelete('user_management');
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useSession();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const mine = new Set(me?.permissions ?? []);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['roles'] });
    onDone();
  };
  const save = useMutation({
    mutationFn: () => {
      const json = { name, description: description || null, permissions: [...perms] };
      return role ? api(`/tenants/current/roles/${role.id}`, { method: 'PUT', json }) : api('/tenants/current/roles', { method: 'POST', json });
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api(`/tenants/current/roles/${role!.id}`, { method: 'DELETE' }), onSuccess: done });
  const toggle = (p: string) => setPerms((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });

  return (
    <form
      className="space-y-4 rounded-lg border border-primary/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="font-medium">{role ? t('Edit {name}', { name: role.name }) : t('New custom role')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="role-name" label={t('Name')}>
          <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} />
        </Field>
        <Field id="role-description" label={t('Description (optional)')}>
          <Textarea id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} rows={2} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('Permissions')}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(GROUPS).map(([res, list]) => (
            <div key={res} className="rounded-md border border-border p-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{label(res)}</p>
              {list.map((p) => (
                <label key={p} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={perms.has(p)} disabled={!mine.has(p)} onChange={() => toggle(p)} />
                  <span className={mine.has(p) ? undefined : 'text-muted-foreground'}>{p.split(':')[1]}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <ErrorText error={save.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending || perms.size === 0 || name.trim().length < 2}>
          {role ? t('Save role') : t('Create role')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('Cancel')}
        </Button>
        {role && mayDelete && (
          <Button type="button" variant="destructive" className="ms-auto" disabled={remove.isPending || role.members > 0} title={role.members > 0 ? t('Move its members to another role first') : undefined} onClick={() => remove.mutate()}>
            {t('Delete role')}
          </Button>
        )}
      </div>
    </form>
  );
}

const SCOPE_LABELS = { OWN: 'Their own records', TEAM: 'Their team’s records', ALL: 'Every record' } as const satisfies Record<RoleRow['recordScope'], MessageKey>;

/** Which company leads, employees and inbound leads people with this role see, and whether they see others' details (ADR 0060). */
function RoleVisibility({ role, canManage }: { role: RoleRow; canManage: boolean }) {
  const t = useT();
  const save = useSetRoleVisibility();
  const fixed = role.key === 'owner' || !canManage;
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {t('Record visibility')}
        <InfoTip topic="team.recordVisibility" />
      </div>
      <label className="flex flex-wrap items-center gap-2">
        <span className="min-w-24 text-xs text-muted-foreground">{t('Sees')}</span>
        <select
          aria-label={t('Records {role} sees', { role: role.name })}
          value={role.recordScope}
          disabled={fixed || save.isPending}
          onChange={(e) => save.mutate({ roleId: role.id, input: { recordScope: e.target.value as RoleRow['recordScope'], viewOthersDetails: role.viewOthersDetails } })}
          className="h-8 flex-1 rounded-md border border-input bg-surface px-2 text-sm"
        >
          {(['OWN', 'TEAM', 'ALL'] as const).map((s) => (
            <option key={s} value={s}>
              {t(SCOPE_LABELS[s])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
          checked={role.viewOthersDetails}
          disabled={fixed || save.isPending}
          onChange={(e) => save.mutate({ roleId: role.id, input: { recordScope: role.recordScope, viewOthersDetails: e.target.checked } })}
        />
        <span>
          {t('Can see details of records others own')}
          <span className="block text-xs text-muted-foreground">{t('Emails, phone numbers, links, notes and custom fields. Off shows only names and statuses.')}</span>
        </span>
      </label>
      {save.error && (
        <p role="alert" className="text-xs text-critical">
          {save.error.message}
        </p>
      )}
    </div>
  );
}
