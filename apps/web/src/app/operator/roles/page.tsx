'use client';

import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import {
  OPERATOR_PERMISSION_DEFS,
  type OperatorPermission,
  type OperatorRoleRow,
  PERMISSION_IMPLIES,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConsoleDenied, ConsoleError, ConsoleLoading } from '@/components/console/console-states';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { can, useOperator } from '../operator-shell';
import { useOperatorRoles } from '../roles-query';

const GROUPS = [...new Set(OPERATOR_PERMISSION_DEFS.map((p) => p.group))];

/**
 * Roles and permissions (ADR 0074): the six built-in roles and any custom ones, and a matrix of the 22 permissions each
 * holds. Built-in roles are fixed; custom roles can be changed or removed once no operator has them.
 */
export default function ConsoleRolesPage() {
  const me = useOperator();
  const allowed = can(me.data, 'operators.manage');
  const roles = useOperatorRoles(allowed);
  const [editing, setEditing] = useState<OperatorRoleRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<OperatorRoleRow | null>(null);

  if (!me.data) return <ConsoleLoading />;
  if (!allowed) return <ConsoleDenied />;
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="What each role can see and do in the Console. The server checks these on every request."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            New role
          </Button>
        }
      />
      {roles.error ? (
        <ConsoleError error={roles.error} onRetry={() => void roles.refetch()} />
      ) : !roles.data ? (
        <ConsoleLoading rows={2} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-console-roles="">
            {roles.data.map((r) => (
              <Card key={r.key} className="flex flex-col p-4" data-role-card={r.name}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <KeyRound className="size-[18px]" aria-hidden />
                    </span>
                    <h2 className="truncate font-medium">{r.name}</h2>
                  </div>
                  <Badge tone={r.builtIn ? 'neutral' : 'primary'}>{r.builtIn ? 'Built in' : 'Custom'}</Badge>
                </div>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{r.description || 'A custom role.'}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {r.permissions.length} of 22 permissions · {r.operators} {r.operators === 1 ? 'operator' : 'operators'}
                  </span>
                  {!r.builtIn && (
                    <span className="flex gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Remove ${r.name}`} onClick={() => setRemoving(r)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
          <Matrix roles={roles.data} />
        </>
      )}
      {editing && <RoleEditor role={editing === 'new' ? null : editing} mine={me.data.permissions} onClose={() => setEditing(null)} />}
      {removing && <RemoveRole role={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

function Matrix({ roles }: { roles: OperatorRoleRow[] }) {
  return (
    <Card className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm" data-permission-matrix="">
        <caption className="p-4 text-start font-medium">Permission matrix</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-t border-border">
            <th scope="col" className="p-3 text-start font-medium">
              Permission
            </th>
            {roles.map((r) => (
              <th key={r.key} scope="col" className="p-3 text-center font-medium">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        {GROUPS.map((g) => (
          <tbody key={g}>
            <tr className="border-t border-border bg-muted/40">
              <th scope="colgroup" colSpan={roles.length + 1} className="px-3 py-1.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {g}
              </th>
            </tr>
            {OPERATOR_PERMISSION_DEFS.filter((p) => p.group === g).map((p) => (
              <tr key={p.key} className="border-t border-border">
                <th scope="row" className="p-3 text-start font-normal">
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                </th>
                {roles.map((r) => {
                  const has = r.permissions.includes(p.key);
                  return (
                    <td key={r.key} className="p-3 text-center" data-cell={`${r.key}:${p.key}`} data-has={has ? 'yes' : 'no'}>
                      {has ? (
                        <Check className="mx-auto size-4 text-success" aria-label="Yes" />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/60" aria-label="No" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </Card>
  );
}

/** Permissions a ticked permission brings along (an edit brings its view), shown ticked and fixed. */
function impliedBy(selected: Set<OperatorPermission>): Set<OperatorPermission> {
  const out = new Set<OperatorPermission>();
  for (const p of selected) for (const q of PERMISSION_IMPLIES[p] ?? []) out.add(q);
  return out;
}

function RoleEditor({ role, mine, onClose }: { role: OperatorRoleRow | null; mine: OperatorPermission[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<OperatorPermission>>(new Set(role?.permissions ?? []));
  const implied = useMemo(() => impliedBy(selected), [selected]);
  const save = useMutation({
    mutationFn: () => {
      const json = { name, description, permissions: [...selected] };
      return role
        ? api<OperatorRoleRow>(`/operator/roles/${role.key}`, { method: 'PATCH', json })
        : api<OperatorRoleRow>('/operator/roles', { method: 'POST', json });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['operator', 'roles'] });
      void qc.invalidateQueries({ queryKey: ['operator', 'operators'] });
      onClose();
    },
  });
  const toggle = (p: OperatorPermission) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[5%] max-h-[85vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{role ? `Edit ${role.name}` : 'New role'}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Choose what operators with this role can do. You can only give permissions you have yourself.
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="role-name" label="Role name">
              <Input id="role-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="role-description" label="Description">
              <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          {GROUPS.map((g) => (
            <fieldset key={g} className="rounded-xl border border-border p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {OPERATOR_PERMISSION_DEFS.filter((p) => p.group === g).map((p) => {
                  const fixed = implied.has(p.key) && !selected.has(p.key);
                  const notMine = !mine.includes(p.key);
                  return (
                    <label key={p.key} className="flex items-start gap-2 rounded-lg p-1.5 text-sm hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selected.has(p.key) || fixed}
                        disabled={fixed || (notMine && !selected.has(p.key))}
                        onChange={() => toggle(p.key)}
                        data-permission={p.key}
                      />
                      <span>
                        <span className="block font-medium">{p.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {fixed ? 'Included with a permission you ticked.' : notMine ? 'You do not have this permission.' : p.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || selected.size === 0}>
              {role ? 'Save role' : 'Create role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveRole({ role, onClose }: { role: OperatorRoleRow; onClose: () => void }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/operator/roles/${role.key}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['operator', 'roles'] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">Remove {role.name}?</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {role.operators > 0
            ? `${role.operators} ${role.operators === 1 ? 'operator has' : 'operators have'} this role. Give them another role first.`
            : 'No operator has this role. Removing it cannot be undone.'}
        </DialogDescription>
        <ErrorText error={remove.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={remove.isPending || role.operators > 0} onClick={() => remove.mutate()}>
            Remove role
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
