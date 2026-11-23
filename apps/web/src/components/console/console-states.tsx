'use client';

import { Button, Skeleton } from '@dealflow/ui';
import { AlertTriangle, Inbox, Lock, type LucideIcon, RotateCw } from 'lucide-react';
import { ApiError } from '@/lib/api';

/**
 * The Console's shared page states (ADR 0074): every module shows one of these instead of a blank screen while it
 * loads, when it has nothing yet, when a request fails, and when the operator's role does not allow it.
 */

export function ConsoleLoading({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-4" data-console-state="loading">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

export function ConsoleEmpty({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center"
      data-console-state="empty"
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 text-primary shadow-inner">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="mt-4 font-medium">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ConsoleError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) return <ConsoleDenied />;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-critical/40 bg-critical/5 p-4"
      data-console-state="error"
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-critical" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">This part of the Console could not load.</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

export function ConsoleDenied({ what = 'this page' }: { what?: string }) {
  return (
    <div
      className="flex flex-col items-center rounded-2xl border border-border px-6 py-12 text-center"
      data-console-state="denied"
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-warning/15 text-warning">
        <Lock className="size-7" aria-hidden />
      </span>
      <h2 className="mt-4 font-medium">Your operator role does not include {what}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Ask a Console administrator to change your role if you need it.
      </p>
    </div>
  );
}
