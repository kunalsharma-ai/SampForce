'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { AI_AGENTS, type AiAgentKey, type AiStatus } from '@dealflow/types';
import { CheckCircle2, CircleSlash, Power } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { aiErrorMessage, useAiStatus, useAiUsage, useUpdateAiSettings } from '@/lib/ai';
import { relativeTime } from '@/lib/format';
import { titleCase } from '@/lib/crm';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';

const RUN_TONE = { SUCCEEDED: 'success', FAILED: 'critical', BLOCKED: 'warning', RUNNING: 'accent', QUEUED: 'neutral' } as const;

export function AgentsConsole() {
  const status = useAiStatus();
  const canManage = useCan('ai:manage');
  const update = useUpdateAiSettings();

  if (status.isPending) return <Skeleton className="h-64" />;
  if (status.error) return <p role="alert" className="text-sm text-critical">{status.error.message}</p>;
  const s = status.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <ProviderCard status={s} />
        <CreditsCard status={s} />
      </div>
      {canManage && <ControlsCard status={s} pending={update.isPending} onChange={(patch) => update.mutate(patch)} />}
      {update.error && (
        <p role="alert" className="text-sm text-critical">
          {aiErrorMessage(update.error)}
        </p>
      )}
      <section aria-labelledby="agents-heading" className="space-y-3">
        <h2 id="agents-heading" className="text-sm font-semibold">
          Agents
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {s.agents.map((a) => (
            <AgentCard
              key={a.key}
              agent={a}
              canManage={canManage}
              pending={update.isPending}
              onToggle={(on) =>
                update.mutate({ disabledAgents: on ? s.settings.disabledAgents.filter((k) => k !== a.key) : [...s.settings.disabledAgents, a.key] })
              }
            />
          ))}
        </div>
      </section>
      {canManage && <UsageSection />}
    </div>
  );
}

function ProviderCard({ status }: { status: AiStatus }) {
  const p = status.provider;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI provider</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{p.name}</span>
          <Badge tone={p.configured ? 'success' : 'warning'}>{p.configured ? 'API key set' : 'Not configured'}</Badge>
          {p.model && <Badge>{p.model}</Badge>}
        </div>
        <p className="text-muted-foreground">{p.note}</p>
      </CardContent>
    </Card>
  );
}

function CreditsCard({ status }: { status: AiStatus }) {
  const c = status.credits;
  const pct = c.limit > 0 ? Math.min(100, Math.round((c.used / c.limit) * 100)) : 100;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI credits this month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          <span className="text-2xl font-semibold tabular-nums">{c.used.toLocaleString(fmtLocale())}</span>
          <span className="text-muted-foreground"> of {c.limit.toLocaleString(fmtLocale())} used</span>
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="AI credits used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${pct >= 90 ? 'bg-critical' : pct >= 70 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          Plan allowance {c.allowance.toLocaleString(fmtLocale())} ({c.seats} active seat{c.seats === 1 ? '' : 's'})
          {status.settings.monthlyCreditCap !== null && `, capped at ${status.settings.monthlyCreditCap.toLocaleString(fmtLocale())} by an admin`}. Resets on{' '}
          {new Date(new Date(c.periodStart).setUTCMonth(new Date(c.periodStart).getUTCMonth() + 1)).toLocaleDateString(fmtLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' })}. When credits run out, AI calls stop until the next period; rule-based features keep working.
        </p>
      </CardContent>
    </Card>
  );
}

function Toggle({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" role="switch" className="mt-1 size-4 accent-[hsl(var(--primary))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        <span className="block text-muted-foreground">{description}</span>
      </label>
    </div>
  );
}

function ControlsCard({ status, pending, onChange }: { status: AiStatus; pending: boolean; onChange: (patch: Parameters<ReturnType<typeof useUpdateAiSettings>['mutate']>[0]) => void }) {
  const s = status.settings;
  const [cap, setCap] = useState(s.monthlyCreditCap?.toString() ?? '');
  useEffect(() => setCap(s.monthlyCreditCap?.toString() ?? ''), [s.monthlyCreditCap]);
  const capValue = cap.trim() === '' ? null : Number(cap);
  const capValid = capValue === null || (Number.isInteger(capValue) && capValue >= 0);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Workspace controls</CardTitle>
        <Button variant={s.enabled ? 'destructive' : 'default'} size="sm" disabled={pending} onClick={() => onChange({ enabled: !s.enabled })}>
          <Power aria-hidden /> {s.enabled ? 'Turn off all AI' : 'Turn AI back on'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!s.enabled && (
          <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            AI is switched off for this workspace. No agent makes model calls; rule-based scores and forecasts still work.
          </p>
        )}
        <Toggle
          label="Qualify new leads automatically"
          description="When a lead is created, Lead Qualification scores it in the background. It never changes the lead's status or owner."
          checked={s.autoQualifyLeads}
          disabled={pending}
          onChange={(v) => onChange({ autoQualifyLeads: v })}
        />
        <Toggle
          label="Remove email addresses, phone and card numbers before sending to the provider"
          description="They are replaced with placeholders and put back in the answer. Card numbers are never put back."
          checked={s.redactPii}
          disabled={pending}
          onChange={(v) => onChange({ redactPii: v })}
        />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (capValid) onChange({ monthlyCreditCap: capValue });
          }}
        >
          <div className="space-y-1">
            <label htmlFor="credit-cap" className="text-sm font-medium">
              Monthly credit cap
            </label>
            <Input id="credit-cap" inputMode="numeric" placeholder="Plan allowance" value={cap} onChange={(e) => setCap(e.target.value)} className="w-44" aria-invalid={!capValid} />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={pending || !capValid || capValue === s.monthlyCreditCap}>
            Save cap
          </Button>
          <p className="w-full text-xs text-muted-foreground">Leave empty to use the full plan allowance. A cap can only lower the allowance.</p>
        </form>
      </CardContent>
    </Card>
  );
}

function AgentCard({ agent, canManage, pending, onToggle }: { agent: AiStatus['agents'][number]; canManage: boolean; pending: boolean; onToggle: (on: boolean) => void }) {
  const def = AI_AGENTS[agent.key as AiAgentKey];
  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{def.name}</CardTitle>
          <Badge tone={agent.available ? 'success' : 'warning'}>{agent.available ? 'Ready' : agent.enabled ? 'Unavailable' : 'Off'}</Badge>
          <Badge>{titleCase(def.tier)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{def.purpose}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {agent.reason && <p className="text-warning">{agent.reason}</p>}
        {def.withoutModel && <p className="text-xs text-muted-foreground">{def.withoutModel}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Can</p>
            <ul className="space-y-1">
              {def.can.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cannot</p>
            <ul className="space-y-1">
              {def.cannot.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-critical" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Needs the {def.permission} permission to run.</p>
        {canManage && (
          <Toggle label={`Allow ${def.name}`} description="Turn this agent off without affecting the others." checked={agent.enabled} disabled={pending} onChange={onToggle} />
        )}
      </CardContent>
    </Card>
  );
}

function UsageSection() {
  const usage = useAiUsage(true);
  if (usage.isPending) return <Skeleton className="h-40" />;
  if (usage.error) return <p role="alert" className="text-sm text-critical">{usage.error.message}</p>;
  const u = usage.data;
  const name = (key: string) => AI_AGENTS[key as AiAgentKey]?.name ?? titleCase(key);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage by agent this month</CardTitle>
        </CardHeader>
        <CardContent>
          {u.byAgent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI calls yet this month.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 text-end font-medium">Calls</th>
                  <th className="pb-2 text-end font-medium">Tokens in / out</th>
                  <th className="pb-2 text-end font-medium">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {u.byAgent.map((r) => (
                  <tr key={r.agent}>
                    <td className="py-2">{name(r.agent)}</td>
                    <td className="py-2 text-end tabular-nums">{r.calls}</td>
                    <td className="py-2 text-end tabular-nums">
                      {r.inputTokens.toLocaleString(fmtLocale())} / {r.outputTokens.toLocaleString(fmtLocale())}
                    </td>
                    <td className="py-2 text-end tabular-nums">{r.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {u.recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agent runs yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {u.recentRuns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
                  <span className="font-medium">{name(r.agent)}</span>
                  <Badge tone={RUN_TONE[r.status]}>{titleCase(r.status)}</Badge>
                  <span className="ms-auto text-xs text-muted-foreground">
                    {r.user?.name ?? 'Automatic'} · {r.creditsUsed} cr · {relativeTime(r.createdAt)}
                  </span>
                  {r.error && <span className="w-full text-xs text-critical">{r.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
