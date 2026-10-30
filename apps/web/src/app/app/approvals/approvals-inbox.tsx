'use client';

import { Badge, Button, Card, CardContent, Input, Skeleton } from '@dealflow/ui';
import type { ApprovalRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApprovals } from '@/lib/automation';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';

const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'critical', EXPIRED: 'neutral', CANCELED: 'neutral' } as const;

export function ApprovalsInbox() {
  const [view, setView] = useState<'PENDING' | 'DECIDED'>('PENDING');
  const list = useApprovals(view);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Approval status" className="flex gap-1 border-b border-border">
        {(['PENDING', 'DECIDED'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${view === v ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
          >
            {v === 'PENDING' ? 'Waiting' : 'Decided'}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <Skeleton className="h-32" />
      ) : list.data?.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{view === 'PENDING' ? 'Nothing is waiting for approval.' : 'No decisions yet.'}</p>
      ) : (
        <ul className="space-y-3">
          {list.data?.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalCard({ approval: a }: { approval: ApprovalRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => api(`/approvals/${a.id}/decision`, { method: 'POST', json: { decision, note: note || undefined } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['approvals'] }), qc.invalidateQueries({ queryKey: ['executions'] }), qc.invalidateQueries({ queryKey: ['quotes'] })]),
  });
  const action = a.payload.action as { type?: string; url?: string; subject?: string } | undefined;
  return (
    <li>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{a.title}</h2>
            <Badge tone={STATUS_TONE[a.status]}>{a.status.charAt(0) + a.status.slice(1).toLowerCase()}</Badge>
            {a.kind === 'quote_discount' ? <Badge tone="accent">Quote discount</Badge> : a.kind !== 'workflow.approval_step' && <Badge tone="accent">External action</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">{relativeTime(a.createdAt)}</span>
          </div>
          {a.summary && <p className="text-sm text-muted-foreground">{a.summary}</p>}
          {action?.url && <p className="break-all text-xs">Endpoint: {action.url}</p>}
          {action?.subject && <p className="text-xs">Subject: {action.subject}</p>}
          {a.kind === 'quote_discount' && typeof a.payload.quoteId === 'string' && (
            <Link href={`/app/quotes/${a.payload.quoteId}`} className="text-xs text-primary hover:underline">
              Open quote {String(a.payload.reference ?? '')}
            </Link>
          )}
          {a.workflow && (
            <Link href={`/app/automation/${a.workflow.id}${a.executionId ? `?run=${a.executionId}` : ''}`} className="text-xs text-primary hover:underline">
              Open workflow “{a.workflow.name}”
            </Link>
          )}
          {a.status === 'PENDING' ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`note-${a.id}`} className="sr-only">
                Note
              </label>
              <Input id={`note-${a.id}`} className="h-9 min-w-48 flex-1" placeholder="Optional note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" onClick={() => decide.mutate('approve')} disabled={decide.isPending}>
                <Check aria-hidden /> Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => decide.mutate('reject')} disabled={decide.isPending}>
                <X aria-hidden /> Reject
              </Button>
              <span className="w-full text-xs text-muted-foreground">Expires {formatDate(a.expiresAt)}</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {a.decidedBy ? `${a.status === 'APPROVED' ? 'Approved' : 'Rejected'} by ${a.decidedBy.name}` : a.status === 'EXPIRED' ? 'Expired without a decision' : 'Canceled'}
              {a.decidedAt && ` · ${relativeTime(a.decidedAt)}`}
              {a.decisionNote && ` · “${a.decisionNote}”`}
            </p>
          )}
          {decide.error && (
            <p role="alert" className="text-sm text-critical">
              {decide.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
