'use client';

import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import { type ConsolePlanRow, FEATURE_GROUPS, type FeatureKey, FEATURES, SUPPORT_LEVEL_LABEL, SUPPORT_LEVELS, type SupportLevel } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { months, price, selectClass, toCents, toLimit } from '../console-ui';

type Limits = ConsolePlanRow['limits'];
const LIMITS: { key: keyof Limits; label: string; nullable: boolean }[] = [
  { key: 'maxManagerWorkspaces', label: 'Manager Workspaces', nullable: true },
  { key: 'maxExecutiveWorkspaces', label: 'Executive Workspaces', nullable: true },
  { key: 'maxUsers', label: 'Users', nullable: true },
  { key: 'maxPipelines', label: 'Pipelines', nullable: true },
  { key: 'monthlyAiCredits', label: 'AI credits per user per month', nullable: false },
  { key: 'automationRunsPerMonth', label: 'Automation runs per month', nullable: false },
];

/**
 * The plans the Console Admin sells (ADR 0071): shipped plans and plans made here, with their price, billing frequency,
 * support level, term, renewal and upgrade settings, workspace limits and features.
 */
export function ConsolePlans({ admin }: { admin: boolean }) {
  const plans = useQuery({ queryKey: ['operator', 'console-plans'], queryFn: () => api<ConsolePlanRow[]>('/operator/console-plans') });
  const [editing, setEditing] = useState<ConsolePlanRow | 'new' | null>(null);
  return (
    <section aria-labelledby="sell-h" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sell-h" className="text-lg font-semibold">
            Plans you sell
          </h2>
          <p className="text-sm text-muted-foreground">Price, term and limits for each plan. A change reaches every client on the plan, and every workspace inside it, on their next request.</p>
        </div>
        {admin && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            New plan
          </Button>
        )}
      </div>
      <ErrorText error={plans.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-console-plans="">
        {(plans.data ?? []).map((p) => (
          <Card key={p.code} className="flex flex-col p-4" data-plan-card={p.code}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{p.name.replace('SampForce ', '')}</h3>
                <p className="text-xs text-muted-foreground">{p.terms.description}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {p.custom ? <Badge tone="primary">Made here</Badge> : <Badge>Shipped</Badge>}
                {!p.terms.available && <Badge tone="warning">Not offered</Badge>}
              </div>
            </div>
            <p className="mt-3 text-xl font-semibold tabular">{price(p.terms.priceCents, p.terms.currency, p.terms.billingFrequency)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Features</dt>
              <dd className="tabular">
                {p.features.length} of {FEATURES.length}
              </dd>
              <dt className="text-muted-foreground">Managers / executives</dt>
              <dd className="tabular">
                {p.limits.maxManagerWorkspaces ?? '∞'} / {p.limits.maxExecutiveWorkspaces ?? '∞'}
              </dd>
              <dt className="text-muted-foreground">Support</dt>
              <dd>{SUPPORT_LEVEL_LABEL[p.terms.supportLevel]}</dd>
              <dt className="text-muted-foreground">Term</dt>
              <dd>
                {months(p.terms.durationMonths)}{p.terms.autoRenew ? ', renews' : ''}
              </dd>
              <dt className="text-muted-foreground">Clients</dt>
              <dd className="tabular">{p.clients}</dd>
            </dl>
            {admin && (
              <Button size="sm" variant="outline" className="mt-3 self-start" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                Edit plan
              </Button>
            )}
          </Card>
        ))}
      </div>
      {editing && <PlanDialog plan={editing === 'new' ? null : editing} plans={plans.data ?? []} onClose={() => setEditing(null)} />}
    </section>
  );
}

function PlanDialog({ plan, plans, onClose }: { plan: ConsolePlanRow | null; plans: ConsolePlanRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const t = plan?.terms;
  const [f, setF] = useState({
    name: plan?.name ?? '', description: t?.description ?? '', price: t?.priceCents === null || t?.priceCents === undefined ? '' : (t.priceCents / 100).toFixed(2), currency: t?.currency ?? 'USD',
    billingFrequency: t?.billingFrequency ?? 'MONTH', supportLevel: (t?.supportLevel ?? 'STANDARD') as SupportLevel, durationMonths: String(t?.durationMonths ?? 12), autoRenew: t?.autoRenew ?? true,
    available: t?.available ?? true, reason: '',
  });
  const [upgradeTo, setUpgradeTo] = useState<Set<string>>(new Set(t?.upgradeTo ?? []));
  const [limits, setLimits] = useState<Record<keyof Limits, string>>(
    () => Object.fromEntries(LIMITS.map((l) => [l.key, plan ? (plan.limits[l.key] === null ? '' : String(plan.limits[l.key])) : l.key === 'monthlyAiCredits' ? '500' : l.key === 'automationRunsPerMonth' ? '10000' : ''])) as Record<keyof Limits, string>,
  );
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set(plan?.features ?? []));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const toggle = (k: FeatureKey) => {
    const n = new Set(features);
    if (n.has(k)) {
      n.delete(k);
      // A subfeature never works without its feature, so taking the feature away takes its subfeatures too.
      for (const sub of FEATURES) if (sub.parent === k) n.delete(sub.key);
    } else {
      n.add(k);
      const parent = FEATURES.find((x) => x.key === k)?.parent;
      if (parent) n.add(parent);
    }
    setFeatures(n);
  };
  const body = () => ({
    ...(plan?.custom !== false ? { name: f.name } : {}),
    features: [...features],
    limits: Object.fromEntries(LIMITS.map((l) => [l.key, l.nullable ? toLimit(limits[l.key]) : Number(limits[l.key]) || 0])),
    terms: {
      description: f.description.trim() || null, priceCents: toCents(f.price), currency: f.currency, billingFrequency: f.billingFrequency, supportLevel: f.supportLevel,
      durationMonths: Number(f.durationMonths) || 1, autoRenew: f.autoRenew, upgradeTo: [...upgradeTo], available: f.available,
    },
    reason: f.reason,
  });
  const save = useMutation({
    mutationFn: () => (plan ? api<ConsolePlanRow[]>(`/operator/console-plans/${plan.code}`, { method: 'PATCH', json: body() }) : api<ConsolePlanRow[]>('/operator/console-plans', { method: 'POST', json: body() })),
    onSuccess: (rows) => {
      qc.setQueryData(['operator', 'console-plans'], rows);
      void qc.invalidateQueries({ queryKey: ['operator', 'plans'] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[5%] max-h-[88vh] max-w-3xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{plan ? `Edit ${plan.name}` : 'New plan'}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {plan ? `${plan.clients} client${plan.clients === 1 ? '' : 's'} on this plan get the change on their next request.` : 'Choose what the plan includes and what it costs. You can assign it to clients straight away.'}
        </DialogDescription>
        <form
          className="mt-4 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">Plan and price</legend>
            <Field id="pl-name" label="Name" hint={plan && !plan.custom ? 'Shipped plans keep their names.' : undefined}>
              <Input id="pl-name" required minLength={2} value={f.name} disabled={!!plan && !plan.custom} onChange={set('name')} />
            </Field>
            <Field id="pl-desc" label="Description" className="sm:col-span-2">
              <Input id="pl-desc" value={f.description} onChange={set('description')} />
            </Field>
            <Field id="pl-price" label="Price per period" hint="Empty: priced per client">
              <Input id="pl-price" inputMode="decimal" value={f.price} onChange={set('price')} />
            </Field>
            <Field id="pl-currency" label="Currency">
              <Input id="pl-currency" maxLength={3} required value={f.currency} onChange={set('currency')} />
            </Field>
            <Field id="pl-billing" label="Billing frequency">
              <select id="pl-billing" className={selectClass} value={f.billingFrequency} onChange={set('billingFrequency')}>
                <option value="MONTH">Monthly</option>
                <option value="YEAR">Yearly</option>
              </select>
            </Field>
            <Field id="pl-support" label="Support level">
              <select id="pl-support" className={selectClass} value={f.supportLevel} onChange={set('supportLevel')}>
                {SUPPORT_LEVELS.map((s) => (
                  <option key={s} value={s}>
                    {SUPPORT_LEVEL_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pl-term" label="Term in months">
              <Input id="pl-term" type="number" min={1} max={120} required value={f.durationMonths} onChange={set('durationMonths')} />
            </Field>
            <div className="flex flex-col justify-end gap-1 pb-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} />
                Renews by itself
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} />
                Offered to new clients
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Upgrades allowed to</legend>
            <p className="mb-2 text-xs text-muted-foreground">None ticked: any plan.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {plans
                .filter((p) => p.code !== plan?.code)
                .map((p) => (
                  <label key={p.code} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={upgradeTo.has(p.code)}
                      onChange={() => {
                        const n = new Set(upgradeTo);
                        if (n.has(p.code)) n.delete(p.code);
                        else n.add(p.code);
                        setUpgradeTo(n);
                      }}
                    />
                    {p.name.replace('SampForce ', '')}
                  </label>
                ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">Limits</legend>
            {LIMITS.map((l) => (
              <Field key={l.key} id={`pl-${l.key}`} label={l.label} hint={l.nullable ? 'Empty: no limit' : undefined}>
                <Input id={`pl-${l.key}`} type="number" min={0} required={!l.nullable} value={limits[l.key]} onChange={(e) => setLimits({ ...limits, [l.key]: e.target.value })} />
              </Field>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">
              Features <span className="font-normal text-muted-foreground">({features.size} of {FEATURES.length})</span>
            </legend>
            <div className="mb-2 flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setFeatures(new Set(FEATURES.map((x) => x.key)))}>
                All
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setFeatures(new Set())}>
                None
              </Button>
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {FEATURE_GROUPS.map((group) => (
                <fieldset key={group} className="space-y-1">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</legend>
                  {FEATURES.filter((x) => x.group === group).map((x) => (
                    <label key={x.key} className={`flex items-start gap-2 text-sm ${x.parent ? 'ps-5' : ''}`} title={x.description}>
                      <input type="checkbox" className="mt-0.5" checked={features.has(x.key)} onChange={() => toggle(x.key)} name={x.key} />
                      {x.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </fieldset>
          <Field id="pl-reason" label="Reason" hint="Recorded in the audit log.">
            <Input id="pl-reason" required minLength={5} value={f.reason} onChange={set('reason')} />
          </Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {plan ? 'Save plan' : 'Create plan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
