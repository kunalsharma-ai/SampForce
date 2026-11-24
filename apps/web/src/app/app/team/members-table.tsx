'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { MemberRemoved, MemberRow } from '@dealflow/types';
import { UserMinus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { RemoveMemberDialog } from './remove-member';
import { RolesManager } from './roles-manager';
import { fmtLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';
import { useDepartments, useDesignations, useSetMemberOrg } from '@/lib/company-crm';

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
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [removed, setRemoved] = useState<MemberRemoved | null>(null);
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
          <div className="flex items-center gap-1.5">
            <CardTitle>{t('Members')}</CardTitle>
            <InfoTip topic="team.members" />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {error && (
            <p role="alert" className="mb-3 text-sm text-critical">
              {error}
            </p>
          )}
          {removed && (
            <p role="status" className="mb-3 rounded-md bg-success/10 px-3 py-2 text-sm" data-member-removed>
              {removed.handoverTo
                ? t('{name} was removed. {count} records and tasks now belong to {person}.', { name: removed.name, count: removed.recordsMoved, person: removed.handoverTo })
                : t('{name} was removed.', { name: removed.name })}
            </p>
          )}
          {members.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">{t('Workspace members')}</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">{t('Name')}</th>
                  <th scope="col" className="py-2 font-medium">{t('Email')}</th>
                  <th scope="col" className="py-2 font-medium">{t('Role')}</th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      {t('Position')}
                      <InfoTip topic="team.position" />
                    </span>
                  </th>
                  <th scope="col" className="py-2 font-medium">{t('Joined')}</th>
                  {canManage && (
                    <th scope="col" className="py-2">
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  )}
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
                    <td className="py-2.5">
                      <MemberPosition member={m} members={members.data ?? []} canManage={canManage} />
                    </td>
                    <td className="py-2.5 text-muted-foreground">{new Date(m.joinedAt).toLocaleDateString(fmtLocale())}</td>
                    {canManage && (
                      <td className="py-2.5 text-end">
                        {m.userId !== me?.user.id && (m.roleKey !== 'owner' || me?.role === 'owner') && (
                          <Button variant="ghost" size="sm" aria-label={t('Remove {name}', { name: m.name })} onClick={() => (setRemoved(null), setRemoving(m))}>
                            <UserMinus aria-hidden /> {t('Remove')}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {removing && <RemoveMemberDialog member={removing} onClose={() => setRemoving(null)} onRemoved={setRemoved} />}
        </CardContent>
      </Card>

      <RolesManager />
    </div>
  );
}

const selectClass = 'h-8 w-full max-w-56 rounded-md border border-input bg-surface px-2 text-sm';

/** Designation, department and reporting manager: what Command Center a person gets and who sees their records (ADR 0060). */
function MemberPosition({ member: m, members, canManage }: { member: MemberRow; members: MemberRow[]; canManage: boolean }) {
  const t = useT();
  const designations = useDesignations();
  const departments = useDepartments();
  const save = useSetMemberOrg();
  if (!canManage)
    return (
      <span className="block space-y-0.5 text-xs">
        <span className="block font-medium text-foreground">{m.designation ? t.maybe(m.designation.name) : t('No designation')}</span>
        {m.department && <span className="block text-muted-foreground">{t.maybe(m.department.name)}</span>}
        {m.reportingManager && <span className="block text-muted-foreground">{t('Reports to {name}', { name: m.reportingManager.name })}</span>}
      </span>
    );
  const set = (input: { designationId?: string | null; departmentId?: string | null; reportingManagerId?: string | null }) => save.mutate({ membershipId: m.membershipId, input });
  return (
    <span className="block space-y-1">
      <select aria-label={t('Designation for {name}', { name: m.name })} value={m.designation?.id ?? ''} disabled={save.isPending} onChange={(e) => set({ designationId: e.target.value || null })} className={selectClass}>
        <option value="">{t('No designation')}</option>
        {designations.data
          ?.filter((d) => !d.archived || d.id === m.designation?.id)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {t.maybe(d.name)}
            </option>
          ))}
      </select>
      <select aria-label={t('Department for {name}', { name: m.name })} value={m.department?.id ?? ''} disabled={save.isPending} onChange={(e) => set({ departmentId: e.target.value || null })} className={selectClass}>
        <option value="">{t('No department')}</option>
        {departments.data
          ?.filter((d) => !d.archived || d.id === m.department?.id)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {t.maybe(d.name)}
            </option>
          ))}
      </select>
      <select aria-label={t('Reporting manager for {name}', { name: m.name })} value={m.reportingManager?.id ?? ''} disabled={save.isPending} onChange={(e) => set({ reportingManagerId: e.target.value || null })} className={selectClass}>
        <option value="">{t('Reports to nobody')}</option>
        {members
          .filter((o) => o.userId !== m.userId && o.status === 'ACTIVE')
          .map((o) => (
            <option key={o.userId} value={o.userId}>
              {t('Reports to {name}', { name: o.name })}
            </option>
          ))}
      </select>
      {save.error && (
        <span role="alert" className="block text-xs text-critical">
          {save.error.message}
        </span>
      )}
    </span>
  );
}
