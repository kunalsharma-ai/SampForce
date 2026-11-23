'use client';

import { Badge, Button, Card } from '@dealflow/ui';
import type { OperatorLoginEventRow, OperatorSessionRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Monitor } from 'lucide-react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { fmtLocale } from '@/lib/i18n/locale';

/** Shared pieces of the Console's account and Security pages (ADR 0074): session and sign-in lists. */

export const when = (iso: string) => new Date(iso).toLocaleString(fmtLocale(), { dateStyle: 'medium', timeStyle: 'short' });

const OUTCOME: Record<OperatorLoginEventRow['outcome'], { label: string; tone: 'success' | 'warning' | 'critical' | 'neutral' }> = {
  success: { label: 'Signed in', tone: 'success' },
  wrong_password: { label: 'Wrong password', tone: 'warning' },
  wrong_code: { label: 'Wrong code', tone: 'warning' },
  locked: { label: 'Paused', tone: 'critical' },
  disabled: { label: 'Account off', tone: 'neutral' },
};

export function SessionList({ rows, showOperator = false }: { rows: OperatorSessionRow[]; showOperator?: boolean }) {
  const qc = useQueryClient();
  const end = useMutation({
    mutationFn: (id: string) => api(`/operator/me/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operator'] }),
  });
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">No sessions are open.</p>;
  return (
    <>
      <ErrorText error={end.error} />
      <ul className="divide-y divide-border" data-session-list="">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-4" data-session={s.current ? 'current' : 'other'}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Monitor className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {showOperator ? `${s.operatorName} · ` : ''}
                {s.device}
                {s.current && (
                  <Badge tone="success" className="ms-2">
                    This browser
                  </Badge>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">
                {s.ip ?? 'Unknown address'} · signed in {when(s.createdAt)} · last active {when(s.lastSeenAt)}
              </span>
            </span>
            {!s.current && (
              <Button size="sm" variant="outline" disabled={end.isPending} onClick={() => end.mutate(s.id)} aria-label={`Sign out ${showOperator ? `${s.operatorName} on ` : ''}${s.device}, last active ${when(s.lastSeenAt)}`}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function LoginTable({ rows, showOperator = false }: { rows: OperatorLoginEventRow[]; showOperator?: boolean }) {
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">No sign-ins yet.</p>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" data-login-history="">
        <caption className="sr-only">Sign-ins</caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="p-3 text-start font-medium">When</th>
            {showOperator && <th scope="col" className="p-3 text-start font-medium">Operator</th>}
            <th scope="col" className="p-3 text-start font-medium">Result</th>
            <th scope="col" className="p-3 text-start font-medium">Device</th>
            <th scope="col" className="p-3 text-start font-medium">Address</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-t border-border" data-login={e.outcome} data-suspicious={e.suspicious ? 'yes' : 'no'}>
              <td className="p-3 tabular">{when(e.createdAt)}</td>
              {showOperator && (
                <td className="p-3">
                  <span className="block">{e.operatorName ?? 'Unknown account'}</span>
                  <span className="block text-xs text-muted-foreground">{e.email}</span>
                </td>
              )}
              <td className="p-3">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={OUTCOME[e.outcome].tone}>{OUTCOME[e.outcome].label}</Badge>
                  {e.suspicious && (
                    <Badge tone="critical">
                      <AlertTriangle className="size-3" aria-hidden /> Unusual: {e.reason}
                    </Badge>
                  )}
                </span>
              </td>
              <td className="p-3">{e.device}</td>
              <td className="p-3 tabular text-muted-foreground">{e.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
