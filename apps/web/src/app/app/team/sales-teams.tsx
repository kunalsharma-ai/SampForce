'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import type { MemberRow, TeamInput, TeamRow } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { gamificationApi, useGamificationMutation, useTeams } from '@/lib/gamification';
import { useCan } from '@/lib/session';
import { useT } from '@/lib/i18n';

/** Sales teams: groups of members for team leaderboards and team challenges. */
export function SalesTeams() {
  const t = useT();
  const teams = useTeams();
  const canManage = useCan('members:manage');
  const [editing, setEditing] = useState<TeamRow | 'new' | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t('Sales teams')}</CardTitle>
        {canManage && <Button size="sm" onClick={() => setEditing('new')}>{t('New team')}</Button>}
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">{t('Used for team leaderboards and team challenges in Sales Gamification. A person can be in more than one team.')}</p>
        {teams.isPending ? (
          <Skeleton className="h-16" />
        ) : !teams.data?.length ? (
          <p className="text-sm text-muted-foreground">{t('No teams yet.')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm" aria-label={t('Sales teams')}>
            {teams.data.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.description && <p className="text-muted-foreground">{item.description}</p>}
                  <p className="text-muted-foreground">{item.members.length ? item.members.map((m) => m.name).join(', ') : t('No members')}</p>
                </div>
                {canManage && (
                  <Button size="sm" variant="outline" aria-label={t('Edit {name}', { name: item.name })} onClick={() => setEditing(item)}>
                    {t('Edit')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing && <TeamDialog team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TeamDialog({ team, onClose }: { team: TeamRow | null; onClose: () => void }) {
  const t = useT();
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<MemberRow[]>('/tenants/current/members') });
  const [form, setForm] = useState<TeamInput>({ name: team?.name ?? '', description: team?.description ?? null, memberUserIds: team?.members.map((m) => m.id) ?? [] });
  const save = useGamificationMutation((b: TeamInput) => (team ? gamificationApi.updateTeam(team.id, b) : gamificationApi.createTeam(b)), onClose);
  const remove = useGamificationMutation(() => gamificationApi.removeTeam(team!.id), onClose);
  const [confirm, setConfirm] = useState(false);
  const active = (members.data ?? []).filter((m) => m.status === 'ACTIVE');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-md">
        <div>
          <DialogTitle className="text-lg font-semibold">{team ? t('Edit team') : t('New team')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Choose who is in this team.')}</DialogDescription>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t('Team name')}</span>
            <Input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t('Description')}</span>
            <Input maxLength={300} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value || null })} />
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">{t('Members')}</legend>
            {members.isPending ? (
              <Skeleton className="h-16" />
            ) : (
              active.map((m) => (
                <label key={m.userId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.memberUserIds.includes(m.userId)}
                    onChange={(e) => setForm({ ...form, memberUserIds: e.target.checked ? [...form.memberUserIds, m.userId] : form.memberUserIds.filter((x) => x !== m.userId) })}
                  />
                  {m.name} <span className="text-muted-foreground">({m.roleName})</span>
                </label>
              ))
            )}
          </fieldset>
          {(save.error || remove.error) && <p role="alert" className="text-sm text-critical">{(save.error ?? remove.error)!.message}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            {team ? (
              confirm ? (
                <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(undefined)}>{t('Confirm delete')}</Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => setConfirm(true)}>{t('Delete team')}</Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>{t('Close')}</Button>
              <Button type="submit" disabled={save.isPending}>{t('Save team')}</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
