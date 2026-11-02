'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { MemberRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { RolesManager } from './roles-manager';
import { fmtLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n';

interface RoleRow {
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export function MembersTable() {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useSession();
  const canManage = useCan('members:manage');
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<MemberRow[]>('/tenants/current/members') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/tenants/current/roles') });

  const change = useMutation({
    mutationFn: ({ id, roleKey }: { id: string; roleKey: string }) =>
      api<MemberRow>(`/tenants/current/members/${id}/role`, { method: 'PATCH', json: { roleKey } }),
    onMutate: () => setError(null),
    onError: (e) => setError(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Members')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {error && (
            <p role="alert" className="mb-3 text-sm text-critical">
              {error}
            </p>
          )}
          {members.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">{t('Workspace members')}</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">{t('Name')}</th>
                  <th scope="col" className="py-2 font-medium">{t('Email')}</th>
                  <th scope="col" className="py-2 font-medium">{t('Role')}</th>
                  <th scope="col" className="py-2 font-medium">{t('Joined')}</th>
                </tr>
              </thead>
              <tbody>
                {members.data?.map((m) => (
                  <tr key={m.membershipId} className="border-t border-border">
                    <td className="py-2.5 font-medium">
                      {m.name} {m.userId === me?.user.id && <Badge className="ms-1">{t('You')}</Badge>}
                      <span className="mt-1 flex flex-wrap gap-1">
                        {m.status === 'SUSPENDED' && <Badge tone="warning">{t('Suspended')}</Badge>}
                        {m.mfaEnabled ? <Badge tone="success">{t('Two-step on')}</Badge> : <Badge>{t('Two-step off')}</Badge>}
                        {m.provisioned && <Badge tone="accent">SCIM</Badge>}
                      </span>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{m.email}</td>
                    <td className="py-2.5">
                      {canManage && roles.data ? (
                        <select
                          aria-label={t('Role for {name}', { name: m.name })}
                          value={m.roleKey}
                          disabled={change.isPending}
                          onChange={(e) => change.mutate({ id: m.membershipId, roleKey: e.target.value })}
                          className="h-8 rounded-md border border-input bg-surface px-2 text-sm"
                        >
                          {roles.data.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        m.roleName
                      )}
                    </td>
                    <td className="py-2.5 text-muted-foreground">{new Date(m.joinedAt).toLocaleDateString(fmtLocale())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <RolesManager />
    </div>
  );
}
