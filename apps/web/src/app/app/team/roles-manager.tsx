'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { PERMISSIONS, type RoleRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useBilling, useRoles } from '@/lib/billing';
import { useCan, useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';

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
  const applied = billing.data?.catalog.find((p) => p.code === billing.data?.appliedPlan);
  const included = applied?.entitlements.customRoles;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{t('Roles')}</CardTitle>
          <CardDescription>
            {included === false ? t('System roles are fixed. Custom roles combine individual permissions and are included from the Professional plan. You can only grant permissions your own role has.') : t('System roles are fixed. Custom roles combine individual permissions. You can only grant permissions your own role has.')}
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
        {role && (
          <Button type="button" variant="destructive" className="ms-auto" disabled={remove.isPending || role.members > 0} title={role.members > 0 ? t('Move its members to another role first') : undefined} onClick={() => remove.mutate()}>
            {t('Delete role')}
          </Button>
        )}
      </div>
    </form>
  );
}
