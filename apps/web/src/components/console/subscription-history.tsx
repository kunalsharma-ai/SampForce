'use client';

import { Badge, Card, cn } from '@dealflow/ui';
import { type ConsoleSubscriptionEvent, SUBSCRIPTION_EVENT_LABEL, SUBSCRIPTION_STATE_LABEL, type SubscriptionEventKind } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Ban, CalendarClock, CirclePause, CirclePlay, FlaskConical, Pencil, RefreshCw, Sparkles, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtLocale } from '@/lib/i18n/locale';

const ICON: Record<SubscriptionEventKind, { icon: typeof Sparkles; tone: string }> = {
  CREATED: { icon: Sparkles, tone: 'bg-primary/10 text-primary' },
  UPGRADED: { icon: ArrowUpRight, tone: 'bg-success/10 text-success' },
  DOWNGRADED: { icon: ArrowDownRight, tone: 'bg-warning/10 text-warning' },
  PLAN_CHANGED: { icon: ArrowRight, tone: 'bg-primary/10 text-primary' },
  RENEWED: { icon: RefreshCw, tone: 'bg-success/10 text-success' },
  TERMS_CHANGED: { icon: Pencil, tone: 'bg-muted text-muted-foreground' },
  PAYMENT_CHANGED: { icon: Wallet, tone: 'bg-primary/10 text-primary' },
  TRIAL_STARTED: { icon: FlaskConical, tone: 'bg-accent/10 text-accent' },
  TRIAL_EXTENDED: { icon: FlaskConical, tone: 'bg-accent/10 text-accent' },
  CANCEL_SCHEDULED: { icon: CalendarClock, tone: 'bg-warning/10 text-warning' },
  CANCELLED: { icon: Ban, tone: 'bg-critical/10 text-critical' },
  REACTIVATED: { icon: CirclePlay, tone: 'bg-success/10 text-success' },
  SUSPENDED: { icon: CirclePause, tone: 'bg-critical/10 text-critical' },
  RESUMED: { icon: CirclePlay, tone: 'bg-success/10 text-success' },
};

/**
 * The client's subscription history (control center K3): every start, upgrade, downgrade, renewal, trial, payment and
 * cancellation, newest first, with who did it, why, and the state before and after.
 */
export function SubscriptionHistory({ clientId }: { clientId: string }) {
  const q = useQuery({
    queryKey: ['operator', 'client', clientId, 'subscription-events'],
    queryFn: () => api<ConsoleSubscriptionEvent[]>(`/operator/clients/${clientId}/subscription/events`),
  });
  return (
    <Card className="p-5" aria-labelledby="subhist-h" data-subscription-history>
      <h2 id="subhist-h" className="font-medium">
        Subscription history
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Every change to the plan, term, payment and status, with who made it and why.</p>
      {q.isPending ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : q.error ? (
        <p role="alert" className="mt-4 text-sm text-critical">
          {q.error.message}
        </p>
      ) : !q.data.length ? (
        <p className="mt-4 text-sm text-muted-foreground">No changes recorded yet. Changes made from now on appear here.</p>
      ) : (
        <ol className="relative mt-5 space-y-5 border-s border-border ps-6">
          {q.data.map((e) => {
            const { icon: Icon, tone } = ICON[e.kind];
            return (
              <li key={e.id} className="relative" data-subscription-event={e.kind}>
                <span className={cn('absolute -start-[37px] top-0 grid size-7 place-items-center rounded-full ring-4 ring-surface', tone)} aria-hidden>
                  <Icon className="size-3.5" />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium">{SUBSCRIPTION_EVENT_LABEL[e.kind]}</span>
                  {e.fromPlan && e.toPlan && e.fromPlan !== e.toPlan && (
                    <span className="text-sm">
                      {e.fromPlan.replace('SampForce ', '')} → {e.toPlan.replace('SampForce ', '')}
                    </span>
                  )}
                  {!e.fromPlan && e.toPlan && <span className="text-sm">{e.toPlan.replace('SampForce ', '')}</span>}
                  {e.fromState && e.toState && (
                    <Badge tone="neutral">
                      {SUBSCRIPTION_STATE_LABEL[e.fromState]} → {SUBSCRIPTION_STATE_LABEL[e.toState]}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={e.at}>{new Date(e.at).toLocaleString(fmtLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</time>
                  {e.by ? ` · ${e.by}` : ' · by the client or the billing provider'}
                </p>
                {e.reason && <p className="mt-1 text-sm">“{e.reason}”</p>}
                {e.changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    {e.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
