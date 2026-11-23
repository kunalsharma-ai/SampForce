'use client';

import { Badge, Button, Card, Input } from '@dealflow/ui';
import {
  type ClientWorkspaceRules,
  FEATURE_GROUPS,
  type FeatureGroup,
  type RuleLevel,
  type WorkspaceRules,
  type WorkspaceRulesOverride,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

/*
 * Console rules for client workspaces (workspace redesign W3). The console is for platform staff and reads in
 * English. The rules are limits: a client's Super Workspace chooses within them.
 */

const LEVEL_LABEL: Record<RuleLevel, string> = { SUPER: 'Super Workspace', MANAGER: 'Manager Workspaces', EXECUTIVE: 'Executive Workspaces' };

/** Checkboxes for one set of rules. */
export function RulesEditor({ value, onChange, disabled, name }: { value: WorkspaceRules; onChange: (r: WorkspaceRules) => void; disabled: boolean; name: string }) {
  const id = useId();
  const toggleModule = (key: 'managerModules' | 'executiveModules', g: FeatureGroup, on: boolean) =>
    onChange({ ...value, [key]: FEATURE_GROUPS.filter((x) => (x === g ? on : value[key].includes(x))) });
  return (
    <div className="space-y-4 text-sm">
      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-medium">Deleting data</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={disabled} checked={value.managerDelete} onChange={(e) => onChange({ ...value, managerDelete: e.target.checked })} />
          Manager Workspaces may be given Delete
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={disabled} checked={value.executiveDelete} onChange={(e) => onChange({ ...value, executiveDelete: e.target.checked })} />
          Executive Workspaces may be given Delete
        </label>
        <p className="text-xs text-muted-foreground">Off means nobody at that level can delete, whatever the client&apos;s Super Workspace ticks. Deleting always asks for a password.</p>
      </fieldset>
      {(['managerModules', 'executiveModules'] as const).map((key) => (
        <fieldset key={key} className="space-y-1.5" data-rule-modules={key}>
          <legend className="mb-1 font-medium">{key === 'managerModules' ? 'Modules Manager Workspaces may use' : 'Modules Executive Workspaces may use'}</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {FEATURE_GROUPS.map((g) => (
              <label key={g} className="flex items-center gap-2">
                <input type="checkbox" disabled={disabled} checked={value[key].includes(g)} onChange={(e) => toggleModule(key, g, e.target.checked)} aria-label={`${key === 'managerModules' ? 'Managers' : 'Executives'}: ${g}`} />
                {g}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-medium">Two-step sign-in required for</legend>
        <div className="flex flex-wrap gap-4">
          {(['SUPER', 'MANAGER', 'EXECUTIVE'] as const).map((l) => (
            <label key={l} className="flex items-center gap-2" htmlFor={`${id}-${name}-mfa-${l}`}>
              <input
                id={`${id}-${name}-mfa-${l}`}
                type="checkbox"
                disabled={disabled}
                checked={value.mfaRequired[l]}
                onChange={(e) => onChange({ ...value, mfaRequired: { ...value.mfaRequired, [l]: e.target.checked } })}
              />
              {LEVEL_LABEL[l]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">People at that level who sign in with a password must set up two-step sign-in before they can work.</p>
      </fieldset>
    </div>
  );
}

/** The fields of `next` that differ from `base`, as a client override; null when nothing differs. */
export function overrideFrom(base: WorkspaceRules, next: WorkspaceRules): WorkspaceRulesOverride | null {
  const out: WorkspaceRulesOverride = {};
  if (next.managerDelete !== base.managerDelete) out.managerDelete = next.managerDelete;
  if (next.executiveDelete !== base.executiveDelete) out.executiveDelete = next.executiveDelete;
  if (next.managerModules.join() !== base.managerModules.join()) out.managerModules = next.managerModules;
  if (next.executiveModules.join() !== base.executiveModules.join()) out.executiveModules = next.executiveModules;
  const mfa = (['SUPER', 'MANAGER', 'EXECUTIVE'] as const).filter((l) => next.mfaRequired[l] !== base.mfaRequired[l]);
  if (mfa.length) out.mfaRequired = Object.fromEntries(mfa.map((l) => [l, next.mfaRequired[l]]));
  return Object.keys(out).length ? out : null;
}

/** Short summary of what a client's override changes, for the card header. */
function describe(o: WorkspaceRulesOverride | null): string {
  if (!o) return 'Uses its plan’s rules';
  const parts: string[] = [];
  if (o.managerDelete !== undefined) parts.push(`Managers ${o.managerDelete ? 'may' : 'may not'} delete`);
  if (o.executiveDelete !== undefined) parts.push(`Executives ${o.executiveDelete ? 'may' : 'may not'} delete`);
  if (o.managerModules) parts.push('own manager modules');
  if (o.executiveModules) parts.push('own executive modules');
  if (o.mfaRequired) parts.push('own two-step sign-in rule');
  return `Differs from its plan: ${parts.join(', ')}`;
}

/** The client profile's card: the rules in force, and an override of the plan's rules for this client only. */
export function ClientWorkspaceRulesCard({ tenantId, admin }: { tenantId: string; admin: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const q = useQuery({ queryKey: ['operator', 'workspace-rules', 'client', tenantId], queryFn: () => api<ClientWorkspaceRules>(`/operator/workspace-rules/clients/${tenantId}`) });
  const [draft, setDraft] = useState<WorkspaceRules | null>(null);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    if (q.data) setDraft(q.data.effective);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (override: WorkspaceRulesOverride | null) => api<ClientWorkspaceRules>(`/operator/workspace-rules/clients/${tenantId}`, { method: 'PUT', json: { override, reason } }),
    onSuccess: (r) => {
      qc.setQueryData(['operator', 'workspace-rules', 'client', tenantId], r);
      setReason('');
      setSaved('Saved. It applies to the client on its next request.');
    },
  });
  if (!q.data || !draft) return <ErrorText error={q.error} />;
  const override = overrideFrom(q.data.planRules, draft);
  return (
    <Card className="space-y-4 p-5" aria-labelledby={`${id}-h`} data-client-workspace-rules="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-h`} className="font-medium">
          Workspace rules
        </h2>
        <Badge tone={q.data.override ? 'warning' : 'neutral'}>{describe(q.data.override)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Limits for this client&apos;s Manager and Executive Workspaces. Change them here for this client only, or on the Workspace rules page for the whole plan.</p>
      <RulesEditor value={draft} onChange={(r) => (setSaved(''), setDraft(r))} disabled={!admin || save.isPending} name="client" />
      {admin && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">
              Reason
            </label>
            <Input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this client differs from its plan" />
          </div>
          <Button disabled={save.isPending || reason.trim().length < 3} onClick={() => save.mutate(override)}>
            Save for this client
          </Button>
          {q.data.override && (
            <Button variant="outline" disabled={save.isPending || reason.trim().length < 3} onClick={() => save.mutate(null)}>
              Use the plan&apos;s rules
            </Button>
          )}
        </div>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {saved}
      </p>
      <ErrorText error={save.error} />
    </Card>
  );
}
