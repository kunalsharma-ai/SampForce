'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@dealflow/ui';
import { type InvitationCreated, type InvitationRow, invitationInputSchema } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { useCan, useSession } from '@/lib/session';

interface RoleRow {
  key: string;
  name: string;
}

const STATUS_TONE = { pending: 'primary', accepted: 'success', revoked: 'neutral', expired: 'warning' } as const;

export function Invitations() {
  const qc = useQueryClient();
  const canManage = useCan('members:manage');
  const { data: me } = useSession();
  const list = useQuery({ queryKey: ['invitations'], queryFn: () => api<InvitationRow[]>('/tenants/current/invitations') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/tenants/current/roles') });
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('member');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const invite = useMutation({
    mutationFn: () => api<InvitationCreated>('/tenants/current/invitations', { method: 'POST', json: { email, roleKey } }),
    onSuccess: (inv) => {
      setCreated(inv);
      setCopied(false);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/tenants/current/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  const assignable = roles.data?.filter((r) => r.key !== 'owner' || me?.role === 'owner') ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = invitationInputSchema.safeParse({ email, roleKey });
              if (!parsed.success) {
                setEmailError(parsed.error.issues[0]?.message);
                return;
              }
              setEmailError(undefined);
              invite.mutate();
            }}
          >
            <Field id="invite-email" label="Email" error={emailError}>
              <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id="invite-role" label="Role">
              <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
                {assignable.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? 'Creating…' : 'Create invitation'}
            </Button>
          </form>
        )}
        {invite.error && (
          <p role="alert" className="text-sm text-critical">
            {invite.error.message}
          </p>
        )}
        {created && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" role="status">
            <p>
              Invitation for <strong>{created.email}</strong> created. Email delivery is not set up yet, so send this link yourself. It works once and expires {formatDate(created.expiresAt)}.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={created.inviteUrl} aria-label="Invitation link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(created.inviteUrl)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false))
                }
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The link is shown only now. If it is lost, create a new invitation; the old one stops working.</p>
          </div>
        )}
        {list.data && list.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">Invitations</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">Email</th>
                  <th scope="col" className="py-2 font-medium">Role</th>
                  <th scope="col" className="py-2 font-medium">Status</th>
                  <th scope="col" className="py-2 font-medium">Expires</th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="py-2">{i.email}</td>
                    <td className="py-2">{i.roleName}</td>
                    <td className="py-2">
                      <Badge tone={STATUS_TONE[i.status]}>{i.status.charAt(0).toUpperCase() + i.status.slice(1)}</Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">{formatDate(i.expiresAt)}</td>
                    <td className="py-2 text-end">
                      {canManage && i.status === 'pending' && (
                        <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending}>
                          <X aria-hidden /> Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          list.data && <p className="text-sm text-muted-foreground">No invitations yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
