'use client';

import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Skeleton,
} from '@dealflow/ui';
import {
  type ActionGrants,
  type ClientState,
  type ConsoleClientCreated,
  type ConsoleClientDetail,
  type ConsolePlanRow,
  type ConsoleWorkspaceRow,
  type HelpSettingsView,
  FEATURE_GROUPS,
  FEATURES,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUSES,
  type PaymentStatus,
  WORKSPACE_ACTION_LABEL,
  WORKSPACE_ACTIONS,
  WORKSPACE_LEVEL_LABEL,
  type WorkspaceAction,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { fmtLocale } from '@/lib/i18n/locale';
import {
  months,
  PaymentBadge,
  price,
  selectClass,
  StateBadge,
  toCents,
  toLimit,
  UsageMeter,
} from '../../console-ui';
import { useOperator } from '../../operator-shell';
import { ClientWorkspaceRulesCard } from '../../workspace-rules/rules-editor';

type Dialogs = 'subscription' | 'renew' | 'state' | 'invite' | 'reopen' | null;

/** One client organisation in the Console (ADR 0071): its subscription, limits, authority, workspaces and history. */
export default function ConsoleClientPage() {
  const { id } = useParams<{ id: string }>();
  const me = useOperator();
  const client = useQuery({
    enabled: !!me.data,
    queryKey: ['operator', 'client', id],
    queryFn: () => api<ConsoleClientDetail>(`/operator/clients/${id}`),
  });
  const [open, setOpen] = useState<Dialogs>(null);
  const [nextState, setNextState] = useState<ClientState>('SUSPENDED');
  if (!me.data || client.isPending) return <Skeleton className="h-96" />;
  if (client.error) return <ErrorText error={client.error} />;
  const c = client.data;
  const s = c.subscription;
  const admin = me.data.role === 'ADMIN';
  const changeState = (to: ClientState) => {
    setNextState(to);
    setOpen('state');
  };

  return (
    <div className="space-y-6">
      <Link
        href="/operator/clients"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Clients
      </Link>
      <PageHeader
        title={c.name}
        description={`Client since ${formatDate(c.createdAt)} · ${c.people} ${c.people === 1 ? 'person' : 'people'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {c.closure ? <Badge tone="critical">Closing</Badge> : <StateBadge state={c.state} />}
            {admin && c.closure && (
              <Button size="sm" onClick={() => setOpen('reopen')}>
                Reopen company
              </Button>
            )}
            {admin && !c.closure && (
              <>
                <Button variant="outline" size="sm" onClick={() => setOpen('renew')}>
                  Renew or upgrade
                </Button>
                {c.state === 'ACTIVE' ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => changeState('SUSPENDED')}>
                      Suspend
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => changeState('DEACTIVATED')}
                    >
                      Deactivate
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => changeState('ACTIVE')}>
                    Activate
                  </Button>
                )}
              </>
            )}
            <Link
              href={`/operator/tenants/${c.id}`}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              Invoices and feature overrides
            </Link>
          </div>
        }
      />

      {c.closure && (
        <div role="note" className="rounded-lg border border-critical/40 bg-critical/5 p-4 text-sm" data-client-closing>
          <p className="font-medium">
            Closed by its owner on {formatDate(c.closure.closedAt)}
            {c.closure.closedBy ? ` (${c.closure.closedBy})` : ''}. Its data is erased on {formatDate(c.closure.eraseAfter)}.
          </p>
          <p className="text-muted-foreground">
            {c.closure.reason ? `Reason given: ${c.closure.reason}. ` : ''}Nobody in the client can sign in. Reopening before that date restores everything.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2" aria-labelledby="sub-h">
          <div className="flex items-center justify-between gap-2">
            <h2 id="sub-h" className="font-medium">
              Subscription
            </h2>
            {admin && s && (
              <Button size="sm" variant="outline" onClick={() => setOpen('subscription')}>
                Change subscription
              </Button>
            )}
          </div>
          {s ? (
            <dl
              className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3"
              data-console-subscription=""
            >
              <Item label="Plan" value={s.planName.replace('SampForce ', '')} />
              <Item label="Price" value={price(s.priceCents, s.currency, s.billingFrequency)} />
              <Item label="Payment" value={<PaymentBadge status={s.paymentStatus} />} />
              <Item label="Started" value={formatDate(s.startedOn)} />
              <Item
                label="Renews"
                value={
                  s.renewsOn ? `${formatDate(s.renewsOn)}${s.autoRenew ? '' : ' (manual)'}` : '—'
                }
              />
              <Item label="Term" value={s.durationMonths ? months(s.durationMonths) : '—'} />
              <Item label="Seats" value={`${c.people} / ${s.seats}`} />
              <Item label="Billing status" value={s.status.toLowerCase().replace('_', ' ')} />
              <Item label="Features" value={`${c.features.length} of ${FEATURES.length}`} />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No subscription.</p>
          )}
        </Card>
        <Card className="space-y-4 p-5" aria-labelledby="usage-h">
          <h2 id="usage-h" className="font-medium">
            Workspace limits
          </h2>
          <UsageMeter
            label="Manager Workspaces"
            used={c.usage.managers}
            max={s?.limits.managers ?? null}
          />
          <UsageMeter
            label="Executive Workspaces"
            used={c.usage.executives}
            max={s?.limits.executives ?? null}
          />
          <p className="text-xs text-muted-foreground">
            {s && (s.limitsSetForClient.managers || s.limitsSetForClient.executives)
              ? 'Set for this client.'
              : 'From the plan.'}{' '}
            Lowering a limit keeps existing workspaces; new ones are refused until the client is
            under it.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5" aria-labelledby="ws-h">
          <h2 id="ws-h" className="font-medium">
            Workspace structure
          </h2>
          <WorkspaceTree rows={c.workspaces} />
        </Card>
        <Card className="space-y-3 p-5" aria-labelledby="admins-h">
          <h2 id="admins-h" className="font-medium">
            Super Workspace administrators
          </h2>
          {c.administrators.length ? (
            <ul className="space-y-1 text-sm">
              {c.administrators.map((a) => (
                <li key={a.email}>
                  <span className="font-medium">{a.name}</span>{' '}
                  <span className="text-muted-foreground">{a.email}</span>
                  {a.designation && (
                    <span className="ms-2 text-xs text-muted-foreground">{a.designation}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nobody has joined yet.</p>
          )}
          {c.pendingAdministrator && (
            <p className="text-sm">
              Invitation sent to <span className="font-medium">{c.pendingAdministrator.email}</span>
              , valid until{' '}
              {new Date(c.pendingAdministrator.expiresAt).toLocaleDateString(fmtLocale())}.
            </p>
          )}
          {admin && (
            <Button size="sm" variant="outline" onClick={() => setOpen('invite')}>
              New invitation link
            </Button>
          )}
        </Card>
      </div>

      <Authority client={c} admin={admin} />
      <ClientWorkspaceRulesCard tenantId={c.id} admin={admin} />
      <HelpAccess tenantId={c.id} admin={admin} />
      <History client={c} />

      {open === 'subscription' && s && (
        <SubscriptionDialog client={c} onClose={() => setOpen(null)} />
      )}
      {open === 'renew' && <RenewDialog client={c} onClose={() => setOpen(null)} />}
      {open === 'state' && <StateDialog client={c} to={nextState} onClose={() => setOpen(null)} />}
      {open === 'invite' && <InviteDialog client={c} onClose={() => setOpen(null)} />}
      {open === 'reopen' && <ReopenDialog client={c} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular">{value}</dd>
    </div>
  );
}

const LEVEL_DOT: Record<ConsoleWorkspaceRow['level'], string> = {
  SUPER: 'bg-primary',
  MANAGER: 'bg-accent',
  EXECUTIVE: 'bg-success',
};

function WorkspaceTree({ rows }: { rows: ConsoleWorkspaceRow[] }) {
  const children = (parent: string | null) => rows.filter((r) => r.parentId === parent);
  const render = (r: ConsoleWorkspaceRow, depth: number): React.ReactNode => (
    <li key={r.id}>
      <div
        className="flex flex-wrap items-center gap-2 py-1"
        style={{ paddingInlineStart: depth * 20 }}
      >
        <span className={`size-2 rounded-full ${LEVEL_DOT[r.level]}`} aria-hidden />
        <span className={r.archived ? 'text-muted-foreground line-through' : 'font-medium'}>
          {r.name}
        </span>
        <span className="text-xs text-muted-foreground">
          {WORKSPACE_LEVEL_LABEL[r.level]} · {r.designation} · {r.people}{' '}
          {r.people === 1 ? 'person' : 'people'}
        </span>
        {r.level === 'MANAGER' && r.canCreateExecutives && <Badge>creates executives</Badge>}
      </div>
      {children(r.id).length > 0 && <ul>{children(r.id).map((ch) => render(ch, depth + 1))}</ul>}
    </li>
  );
  return (
    <ul className="mt-3 text-sm" data-console-workspaces="">
      {children(null).map((r) => render(r, 0))}
    </ul>
  );
}

function useSave(id: string, onDone?: () => void) {
  const qc = useQueryClient();
  return (r: ConsoleClientDetail) => {
    qc.setQueryData(['operator', 'client', id], r);
    void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
    void qc.invalidateQueries({ queryKey: ['operator', 'overview'] });
    onDone?.();
  };
}

function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field
      id={id}
      label="Reason"
      hint="Kept in the client’s subscription history and the audit logs."
    >
      <Input
        id={id}
        required
        minLength={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Shell({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {description}
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionDialog({
  client,
  onClose,
}: {
  client: ConsoleClientDetail;
  onClose: () => void;
}) {
  const s = client.subscription!;
  const plans = useQuery({
    queryKey: ['operator', 'console-plans'],
    queryFn: () => api<ConsolePlanRow[]>('/operator/console-plans'),
  });
  const [f, setF] = useState({
    planCode: s.planCode,
    seats: String(s.seats),
    billingFrequency: s.billingFrequency,
    renewsOn: s.renewsOn ?? '',
    months: s.durationMonths ? String(s.durationMonths) : '',
    price: s.priceCents === null ? '' : (s.priceCents / 100).toFixed(2),
    currency: s.currency,
    paymentStatus: (s.paymentStatus ?? 'PENDING') as PaymentStatus,
    autoRenew: s.autoRenew,
    managers: s.limitsSetForClient.managers ? String(s.limits.managers ?? '') : '',
    executives: s.limitsSetForClient.executives ? String(s.limits.executives ?? '') : '',
    reason: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  const save = useSave(client.id, onClose);
  const m = useMutation({
    mutationFn: () =>
      api<ConsoleClientDetail>(`/operator/clients/${client.id}/subscription`, {
        method: 'PUT',
        json: {
          planCode: f.planCode,
          seats: Number(f.seats) || 1,
          billingFrequency: f.billingFrequency,
          ...(f.renewsOn ? { renewsOn: f.renewsOn } : {}),
          ...(f.months ? { durationMonths: Number(f.months) } : {}),
          priceCents: toCents(f.price),
          currency: f.currency,
          paymentStatus: f.paymentStatus,
          autoRenew: f.autoRenew,
          maxManagerWorkspaces: f.managers.trim() ? toLimit(f.managers) : null,
          maxExecutiveWorkspaces: f.executives.trim() ? toLimit(f.executives) : null,
          reason: f.reason,
        },
      }),
    onSuccess: save,
  });
  return (
    <Shell
      title="Change subscription"
      description="Applies to the Super Workspace and every workspace below it on their next request. Only what you change is recorded."
      onClose={onClose}
    >
      <form
        className="mt-4 grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field id="cs-plan" label="Plan" className="sm:col-span-2">
          <select
            id="cs-plan"
            className={selectClass}
            value={f.planCode}
            onChange={set('planCode')}
          >
            {(plans.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name.replace('SampForce ', '')} · {p.features.length} features
              </option>
            ))}
          </select>
        </Field>
        <Field id="cs-seats" label="Seats">
          <Input id="cs-seats" type="number" min={1} value={f.seats} onChange={set('seats')} />
        </Field>
        <Field id="cs-billing" label="Billing">
          <select
            id="cs-billing"
            className={selectClass}
            value={f.billingFrequency}
            onChange={set('billingFrequency')}
          >
            <option value="MONTH">Monthly</option>
            <option value="YEAR">Yearly</option>
          </select>
        </Field>
        <Field id="cs-price" label="Price per period">
          <Input
            id="cs-price"
            inputMode="decimal"
            value={f.price}
            onChange={set('price')}
            placeholder="Priced per client"
          />
        </Field>
        <Field id="cs-currency" label="Currency">
          <Input id="cs-currency" maxLength={3} value={f.currency} onChange={set('currency')} />
        </Field>
        <Field id="cs-renews" label="Renews on">
          <Input id="cs-renews" type="date" value={f.renewsOn} onChange={set('renewsOn')} />
        </Field>
        <Field id="cs-months" label="Term in months">
          <Input
            id="cs-months"
            type="number"
            min={1}
            max={120}
            value={f.months}
            onChange={set('months')}
          />
        </Field>
        <Field id="cs-payment" label="Payment">
          <select
            id="cs-payment"
            className={selectClass}
            value={f.paymentStatus}
            onChange={set('paymentStatus')}
          >
            {PAYMENT_STATUSES.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_STATUS_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="cs-managers" label="Manager Workspaces" hint="Empty: the plan’s limit">
          <Input
            id="cs-managers"
            type="number"
            min={0}
            value={f.managers}
            onChange={set('managers')}
          />
        </Field>
        <Field id="cs-executives" label="Executive Workspaces" hint="Empty: the plan’s limit">
          <Input
            id="cs-executives"
            type="number"
            min={0}
            value={f.executives}
            onChange={set('executives')}
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={f.autoRenew}
            onChange={(e) => setF({ ...f, autoRenew: e.target.checked })}
          />
          Renews by itself
        </label>
        <div className="sm:col-span-3">
          <ReasonField
            id="cs-reason"
            value={f.reason}
            onChange={(reason) => setF({ ...f, reason })}
          />
        </div>
        <div className="sm:col-span-3">
          <ErrorText error={m.error} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={m.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function RenewDialog({ client, onClose }: { client: ConsoleClientDetail; onClose: () => void }) {
  const plans = useQuery({
    queryKey: ['operator', 'console-plans'],
    queryFn: () => api<ConsolePlanRow[]>('/operator/console-plans'),
  });
  const s = client.subscription;
  const [f, setF] = useState({
    months: s?.durationMonths ? String(s.durationMonths) : '12',
    planCode: s?.planCode ?? '',
    paymentStatus: (s?.paymentStatus ?? 'PENDING') as PaymentStatus,
    reason: '',
  });
  const save = useSave(client.id, onClose);
  const m = useMutation({
    mutationFn: () =>
      api<ConsoleClientDetail>(`/operator/clients/${client.id}/renew`, {
        method: 'POST',
        json: {
          months: Number(f.months) || undefined,
          planCode: f.planCode || undefined,
          paymentStatus: f.paymentStatus,
          reason: f.reason,
        },
      }),
    onSuccess: save,
  });
  return (
    <Shell
      title="Renew or upgrade"
      description="Adds a term from the current renewal date, or from today if that date has passed. Choose another plan to upgrade at the same time."
      onClose={onClose}
    >
      <form
        className="mt-4 grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field id="rn-months" label="Months">
          <Input
            id="rn-months"
            type="number"
            min={1}
            max={120}
            value={f.months}
            onChange={(e) => setF({ ...f, months: e.target.value })}
          />
        </Field>
        <Field id="rn-plan" label="Plan">
          <select
            id="rn-plan"
            className={selectClass}
            value={f.planCode}
            onChange={(e) => setF({ ...f, planCode: e.target.value })}
          >
            {(plans.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name.replace('SampForce ', '')}
              </option>
            ))}
          </select>
        </Field>
        <Field id="rn-payment" label="Payment">
          <select
            id="rn-payment"
            className={selectClass}
            value={f.paymentStatus}
            onChange={(e) => setF({ ...f, paymentStatus: e.target.value as PaymentStatus })}
          >
            {PAYMENT_STATUSES.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_STATUS_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-3">
          <ReasonField
            id="rn-reason"
            value={f.reason}
            onChange={(reason) => setF({ ...f, reason })}
          />
          <ErrorText error={m.error} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={m.isPending}>
            Renew
          </Button>
        </div>
      </form>
    </Shell>
  );
}

const STATE_COPY: Record<ClientState, { title: string; description: string; button: string }> = {
  ACTIVE: {
    title: 'Activate client',
    description:
      'Everyone in the client can sign in again, and a deactivated subscription becomes active.',
    button: 'Activate',
  },
  SUSPENDED: {
    title: 'Suspend client',
    description:
      'Nobody in the client can sign in until you activate it. The subscription and all data are kept.',
    button: 'Suspend',
  },
  DEACTIVATED: {
    title: 'Deactivate client',
    description:
      'Ends the subscription and stops sign-in. All data is kept, and activating restores it.',
    button: 'Deactivate',
  },
};

function StateDialog({
  client,
  to,
  onClose,
}: {
  client: ConsoleClientDetail;
  to: ClientState;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const save = useSave(client.id, onClose);
  const m = useMutation({
    mutationFn: () =>
      api<ConsoleClientDetail>(`/operator/clients/${client.id}/state`, {
        method: 'POST',
        json: { state: to, reason },
      }),
    onSuccess: save,
  });
  const copy = STATE_COPY[to];
  return (
    <Shell title={copy.title} description={copy.description} onClose={onClose}>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <ReasonField id="st-reason" value={reason} onChange={setReason} />
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={to === 'ACTIVE' ? 'default' : 'destructive'}
            disabled={m.isPending}
          >
            {copy.button}
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/** Reopens a company its owner closed (workspace redesign W7): sign-in works again, with everything in it. */
function ReopenDialog({ client, onClose }: { client: ConsoleClientDetail; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useSave(client.id, onClose);
  const m = useMutation({
    mutationFn: () => api<ConsoleClientDetail>(`/operator/clients/${client.id}/reopen`, { method: 'POST', json: { reason } }),
    onSuccess: save,
  });
  return (
    <Shell title="Reopen company" description={`Everyone in ${client.name} can sign in again, and nothing is erased. Possible until ${client.closure ? formatDate(client.closure.eraseAfter) : ''}.`} onClose={onClose}>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <ReasonField id="reopen-reason" value={reason} onChange={setReason} />
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={m.isPending}>
            Reopen company
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function InviteDialog({ client, onClose }: { client: ConsoleClientDetail; onClose: () => void }) {
  const [email, setEmail] = useState(client.pendingAdministrator?.email ?? '');
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      api<ConsoleClientCreated>(`/operator/clients/${client.id}/administrator-invitation`, {
        method: 'POST',
        json: email ? { email } : {},
      }),
    onSuccess: (r) => qc.setQueryData(['operator', 'client', client.id], r.client),
  });
  return (
    <Shell
      title="New invitation link"
      description="The earlier link stops working. The person joins as an owner of the Super Workspace."
      onClose={onClose}
    >
      {m.data ? (
        <div className="mt-4 flex gap-2">
          <Input readOnly value={m.data.inviteUrl} aria-label="Administrator invitation link" />
          <Button
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(m.data!.inviteUrl)}
          >
            <Copy className="size-4" aria-hidden />
            Copy
          </Button>
        </div>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Field id="inv-email" label="Administrator’s email">
            <Input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <ErrorText error={m.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={m.isPending}>
              Create link
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}

/** The Super Workspace's ceiling per module, and whether it creates Executive Workspaces itself. */
function Authority({ client, admin }: { client: ConsoleClientDetail; admin: boolean }) {
  const all = Object.fromEntries(
    FEATURE_GROUPS.map((g) => [g, [...WORKSPACE_ACTIONS]]),
  ) as ActionGrants;
  const [limited, setLimited] = useState(client.authority.actions !== null);
  const [grants, setGrants] = useState<ActionGrants>(client.authority.actions ?? all);
  const [executives, setExecutives] = useState(client.authority.canCreateExecutives);
  const [reason, setReason] = useState('');
  const save = useSave(client.id, () => setReason(''));
  const m = useMutation({
    mutationFn: () =>
      api<ConsoleClientDetail>(`/operator/clients/${client.id}/authority`, {
        method: 'PUT',
        json: { actions: limited ? grants : null, canCreateExecutives: executives, reason },
      }),
    onSuccess: save,
  });
  const toggle = (group: string, action: WorkspaceAction) => {
    const cur = new Set(grants[group] ?? []);
    if (cur.has(action)) cur.delete(action);
    else cur.add(action);
    setGrants({ ...grants, [group]: WORKSPACE_ACTIONS.filter((a) => cur.has(a)) });
  };
  return (
    <Card className="p-5" aria-labelledby="auth-h">
      <h2 id="auth-h" className="font-medium">
        Super Workspace authority
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The most this client’s Super Workspace may do. It can hand less to its Manager and Executive
        Workspaces, never more.
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={executives}
            disabled={!admin}
            onChange={(e) => setExecutives(e.target.checked)}
          />
          The Super Workspace may create Executive Workspaces itself
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={limited}
            disabled={!admin}
            onChange={(e) => setLimited(e.target.checked)}
          />
          Limit the actions it may use in each module
        </label>
        {limited && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm" data-console-authority="">
              <caption className="sr-only">Actions per module</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 text-start font-medium">
                    Module
                  </th>
                  {WORKSPACE_ACTIONS.map((a) => (
                    <th key={a} scope="col" className="px-1 py-1 text-center font-medium">
                      {WORKSPACE_ACTION_LABEL[a]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_GROUPS.map((g) => (
                  <tr key={g} className="border-t border-border">
                    <th scope="row" className="py-1.5 text-start font-normal">
                      {g}
                    </th>
                    {WORKSPACE_ACTIONS.map((a) => (
                      <td key={a} className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${g}: ${WORKSPACE_ACTION_LABEL[a]}`}
                          checked={(grants[g] ?? []).includes(a)}
                          disabled={!admin}
                          onChange={() => toggle(g, a)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {admin && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <ReasonField id="auth-reason" value={reason} onChange={setReason} />
            </div>
            <Button type="submit" disabled={m.isPending}>
              Save authority
            </Button>
          </div>
        )}
        <ErrorText error={m.error} />
      </form>
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'client.created': 'Client created',
  'client.subscription_changed': 'Subscription changed',
  'client.renewed': 'Renewed',
  'client.state_changed': 'Status changed',
  'client.authority_changed': 'Authority changed',
  'client.administrator_invited': 'Administrator invited',
  'tenant.plan_overridden': 'Plan set',
  'tenant.features_overridden': 'Features overridden',
  'tenant.suspended': 'Suspended',
  'tenant.reactivated': 'Reactivated',
  'client.reopened': 'Reopened',
  'client.closed_by_owner': 'Closed by its owner',
  'tenant.closed': 'Closed by its owner',
  'tenant.reopened': 'Reopened',
  'tenant.offline_payment_recorded': 'Payment recorded',
};

function History({ client }: { client: ConsoleClientDetail }) {
  return (
    <Card className="p-5" aria-labelledby="hist-h">
      <h2 id="hist-h" className="font-medium">
        Subscription history
      </h2>
      {client.history.length ? (
        <ol className="mt-3 divide-y divide-border text-sm" data-console-history="">
          {client.history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="py-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(h.at).toLocaleString(fmtLocale())}
                  {h.by ? ` · ${h.by}` : ''}
                </span>
              </div>
              {h.reason && <p className="text-muted-foreground">{h.reason}</p>}
              {h.changes.length > 0 && (
                <ul className="mt-1 list-disc ps-5 text-xs text-muted-foreground">
                  {h.changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No changes yet.</p>
      )}
    </Card>
  );
}

/** Whether this client gets the Help Center's answers and guides (ADR 0073). Their people can always raise queries. */
function HelpAccess({ tenantId, admin }: { tenantId: string; admin: boolean }) {
  const qc = useQueryClient();
  const key = ['operator', 'help', 'client-settings', tenantId];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => api<HelpSettingsView>(`/operator/help/clients/${tenantId}/settings`),
  });
  const m = useMutation({
    mutationFn: (helpEnabled: boolean) =>
      api<HelpSettingsView>(`/operator/help/clients/${tenantId}/settings`, {
        method: 'PUT',
        json: { helpEnabled },
      }),
    onSuccess: (s) => qc.setQueryData(key, s),
  });
  const s = settings.data;
  return (
    <Card className="p-5" aria-labelledby="help-h" data-client-help>
      <h2 id="help-h" className="font-medium">
        Help Center
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Answers, guides and announcements in this client’s Help. Their people can raise and follow
        queries either way.
      </p>
      {!s ? (
        <Skeleton className="mt-3 h-8" />
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={s.helpEnabled}
              disabled={!admin || m.isPending}
              onChange={(e) => m.mutate(e.target.checked)}
              data-client-help-enabled
            />
            Help Center answers and guides for this client
          </label>
          <p className="text-muted-foreground">
            Their Super Workspace chose: Help icon {s.menuVisible ? 'shown' : 'hidden'}, missing
            features {s.explainRestricted ? 'explained' : 'not listed'}
            {s.supportNote ? ', with a note for their people' : ''}.
          </p>
          <ErrorText error={m.error as Error | null} />
        </div>
      )}
    </Card>
  );
}
