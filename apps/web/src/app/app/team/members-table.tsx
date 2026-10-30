'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { MemberRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { RolesManager } from './roles-manager';

interface RoleRow {
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export function MembersTable() {
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
          <CardTitle>Members</CardTitle>
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
              <caption className="sr-only">Workspace members</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">Name</th>
                  <th scope="col" className="py-2 font-medium">Email</th>
                  <th scope="col" className="py-2 font-medium">Role</th>
                  <th scope="col" className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.data?.map((m) => (
                  <tr key={m.membershipId} className="border-t border-border">
                    <td className="py-2.5 font-medium">
                      {m.name} {m.userId === me?.user.id && <Badge className="ml-1">You</Badge>}
                    </td>
                    <td className="py-2.5 text-muted-foreground">{m.email}</td>
                    <td className="py-2.5">
                      {canManage && roles.data ? (
                        <select
                          aria-label={`Role for ${m.name}`}
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
                    <td className="py-2.5 text-muted-foreground">{new Date(m.joinedAt).toLocaleDateString()}</td>
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
