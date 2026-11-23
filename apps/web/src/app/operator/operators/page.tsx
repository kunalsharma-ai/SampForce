'use client';

import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@dealflow/ui';
import type { ConsoleOperatorRow, OperatorInviteResult, OperatorRoleRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Link2, LogOut, MoreHorizontal, Plus, Power, ShieldCheck, ShieldOff, UserCog } from 'lucide-react';
import { useState } from 'react';
import { ConsoleDenied, ConsoleEmpty, ConsoleError, ConsoleLoading } from '@/components/console/console-states';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { fmtLocale } from '@/lib/i18n/locale';
import { selectClass } from '../console-ui';
import { can, useOperator } from '../operator-shell';
import { OPERATOR_ROLES_KEY, useOperatorRoles } from '../roles-query';

const KEY = ['operator', 'operators'] as const;

const STATUS: Record<ConsoleOperatorRow['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INVITED: { label: 'Invited', tone: 'warning' },
  DISABLED: { label: 'Switched off', tone: 'neutral' },
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(fmtLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * Console operators (ADR 0074): who can sign in to the Console, with which role. Operators are invited by a one-time
 * link; a Super Admin can change a role, switch an account off or send a new link. Nobody can change their own access.
 */
export default function ConsoleOperatorsPage() {
  const me = useOperator();
  const allowed = can(me.data, 'operators.manage');
  const list = useQuery({ enabled: allowed, queryKey: KEY, queryFn: () => api<ConsoleOperatorRow[]>('/operator/operators') });
  const roles = useOperatorRoles(allowed);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<ConsoleOperatorRow | null>(null);
  const [link, setLink] = useState<OperatorInviteResult | null>(null);
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'DISABLED' }) =>
      api<ConsoleOperatorRow>(`/operator/operators/${v.id}`, { method: 'PATCH', json: { status: v.status } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  const security = useMutation({
    mutationFn: (v: { id: string; action: 'mfa/reset' | 'sessions/end' }) => api(`/operator/operators/${v.id}/${v.action}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  const canSecurity = can(me.data, 'security.manage');
  const newLink = useMutation({
    mutationFn: (id: string) => api<OperatorInviteResult>(`/operator/operators/${id}/link`, { method: 'POST' }),
    onSuccess: (r) => {
      setLink(r);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });

  if (!me.data) return <ConsoleLoading />;
  if (!allowed) return <ConsoleDenied />;
  const rows = list.data ?? [];
  const active = rows.filter((r) => r.status === 'ACTIVE').length;
  const invited = rows.filter((r) => r.status === 'INVITED').length;
  const withMfa = rows.filter((r) => r.mfaEnabled).length;

  return (
    <>
      <PageHeader
        title="Operators"
        description="Everyone who can sign in to the Console and the role that decides what they can do."
        actions={
          <Button onClick={() => setInviting(true)}>
            <Plus className="size-4" aria-hidden />
            Add operator
          </Button>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Active operators', value: active, icon: UserCog },
          { label: 'Waiting to join', value: invited, icon: Link2 },
          { label: 'Two-step verification on', value: `${withMfa} of ${rows.length}`, icon: ShieldCheck },
        ].map((k) => (
          <Card key={k.label} className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <k.icon className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block text-xs text-muted-foreground">{k.label}</span>
              <span className="block text-xl font-semibold tabular" data-operator-kpi={k.label}>
                {list.data ? k.value : '…'}
              </span>
            </span>
          </Card>
        ))}
      </div>
      <ErrorText error={setStatus.error ?? newLink.error ?? security.error} />
      {list.error ? (
        <ConsoleError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <ConsoleLoading rows={2} />
      ) : rows.length === 0 ? (
        <ConsoleEmpty title="No operators yet" description="Add the first operator to share the work." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-console-operators="">
            <caption className="sr-only">Operators</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 text-start font-medium">Operator</th>
                <th scope="col" className="p-3 text-start font-medium">Role</th>
                <th scope="col" className="p-3 text-start font-medium">Status</th>
                <th scope="col" className="p-3 text-start font-medium">Two-step</th>
                <th scope="col" className="p-3 text-start font-medium">Last sign-in</th>
                <th scope="col" className="p-3 text-end font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const self = o.id === me.data!.id;
                return (
                  <tr key={o.id} className="border-t border-border" data-operator-row={o.email}>
                    <td className="p-3">
                      <span className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-primary-foreground">
                          {initials(o.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {o.name}
                            {self && <span className="ms-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{o.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="p-3" data-operator-role>
                      {o.roleName}
                    </td>
                    <td className="p-3">
                      <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                    </td>
                    <td className="p-3">{o.mfaEnabled ? 'On' : <span className="text-muted-foreground">Off</span>}</td>
                    <td className="p-3 tabular text-muted-foreground">{when(o.lastLoginAt)}</td>
                    <td className="p-3 text-end">
                      {!self && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${o.name}`}>
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(o)}>
                              <KeyRound aria-hidden /> Change role
                            </DropdownMenuItem>
                            {o.status !== 'DISABLED' && (
                              <DropdownMenuItem onSelect={() => newLink.mutate(o.id)}>
                                <Link2 aria-hidden /> {o.status === 'INVITED' ? 'New invitation link' : 'Password reset link'}
                              </DropdownMenuItem>
                            )}
                            {canSecurity && o.mfaEnabled && (
                              <DropdownMenuItem onSelect={() => security.mutate({ id: o.id, action: 'mfa/reset' })}>
                                <ShieldOff aria-hidden /> Reset two-step verification
                              </DropdownMenuItem>
                            )}
                            {canSecurity && o.status === 'ACTIVE' && (
                              <DropdownMenuItem onSelect={() => security.mutate({ id: o.id, action: 'sessions/end' })}>
                                <LogOut aria-hidden /> Sign out everywhere
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => setStatus.mutate({ id: o.id, status: o.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' })}>
                              <Power aria-hidden /> {o.status === 'DISABLED' ? 'Switch on' : 'Switch off'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {inviting && (
        <InviteDialog
          roles={roles.data ?? []}
          onClose={() => setInviting(false)}
          onDone={(r) => {
            setInviting(false);
            setLink(r);
          }}
        />
      )}
      {editing && <RoleDialog operator={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
      {link && <LinkDialog result={link} onClose={() => setLink(null)} />}
    </>
  );
}

function RoleSelect({ id, roles, value, onChange }: { id: string; roles: OperatorRoleRow[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>
        Choose a role
      </option>
      {roles.map((r) => (
        <option key={r.key} value={r.key}>
          {r.name}
          {r.builtIn ? '' : ' (custom)'}
        </option>
      ))}
    </select>
  );
}

function RoleSummary({ roles, value }: { roles: OperatorRoleRow[]; value: string }) {
  const r = roles.find((x) => x.key === value);
  if (!r) return null;
  return (
    <p className="text-xs text-muted-foreground" data-role-summary>
      {r.description || 'A custom role.'} {r.permissions.length} of 22 permissions.
    </p>
  );
}

function InviteDialog({ roles, onClose, onDone }: { roles: OperatorRoleRow[]; onClose: () => void; onDone: (r: OperatorInviteResult) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', email: '', role: 'support' });
  const invite = useMutation({
    mutationFn: () => api<OperatorInviteResult>('/operator/operators', { method: 'POST', json: f }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: OPERATOR_ROLES_KEY });
      onDone(r);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">Add an operator</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          They get a link to choose their own password. It works once, for 72 hours.
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Field id="inv-name" label="Name">
            <Input id="inv-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field id="inv-email" label="Work email">
            <Input id="inv-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field id="inv-role" label="Role">
            <RoleSelect id="inv-role" roles={roles} value={f.role} onChange={(role) => setF({ ...f, role })} />
          </Field>
          <RoleSummary roles={roles} value={f.role} />
          <ErrorText error={invite.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              Send invitation
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ operator, roles, onClose }: { operator: ConsoleOperatorRow; roles: OperatorRoleRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState(operator.role);
  const save = useMutation({
    mutationFn: () => api<ConsoleOperatorRow>(`/operator/operators/${operator.id}`, { method: 'PATCH', json: { role } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: OPERATOR_ROLES_KEY });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">Change {operator.name}’s role</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">The new role applies on their next click.</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field id="op-role" label="Role">
            <RoleSelect id="op-role" roles={roles} value={role} onChange={setRole} />
          </Field>
          <RoleSummary roles={roles} value={role} />
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || role === operator.role}>
              Save role
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ result, onClose }: { result: OperatorInviteResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const invite = result.operator.status === 'INVITED';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{invite ? 'Invitation ready' : 'Reset link ready'}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {result.emailed
            ? `We emailed the link to ${result.operator.email}. It works once, until ${when(result.expiresAt)}.`
            : `Email is not set up on this site, so send this link to ${result.operator.email} yourself. It works once, until ${when(result.expiresAt)}.`}
        </DialogDescription>
        {result.link && (
          <div className="mt-4 flex gap-2">
            <Input readOnly value={result.link} aria-label="Link to choose a password" data-operator-link />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(result.link!);
                setCopied(true);
              }}
            >
              <Copy className="size-4" aria-hidden />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
