'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import { ENROLL_SKIP_LABELS, type EnrollResult } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { ENROLLMENT_LABEL, ENROLLMENT_TONE, useEnrollments, useSequences } from '@/lib/sequences';
import { useCan } from '@/lib/session';

/** The sequences a lead or contact is in, with a quick way to add them to one. */
export function RecordSequences({ leadId, contactId, email }: { leadId?: string; contactId?: string; email: string | null }) {
  const canRead = useCan('sequences:read');
  const canWrite = useCan('sequences:write');
  const qc = useQueryClient();
  const rows = useEnrollments({ leadId, contactId });
  const sequences = useSequences();
  const [choice, setChoice] = useState('');
  const active = (sequences.data ?? []).filter((s) => s.status === 'ACTIVE');
  const enroll = useMutation({
    mutationFn: () => api<EnrollResult>(`/sequences/${choice}/enroll`, { method: 'POST', json: leadId ? { leadIds: [leadId] } : { contactIds: [contactId] } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
  });
  if (!canRead) return null;
  const skipped = enroll.data?.skipped[0];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sequences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.data?.length ? (
          <ul className="space-y-1">
            {rows.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/app/sequences/${r.sequence.id}`} className="font-medium hover:underline">
                  {r.sequence.name}
                </Link>
                <Badge tone={ENROLLMENT_TONE[r.status]}>{ENROLLMENT_LABEL[r.status]}</Badge>
                <span className="text-xs text-muted-foreground">{r.sent} sent</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Not in any sequence.</p>
        )}
        {canWrite && email && active.length > 0 && (
          <div className="flex items-end gap-2">
            <Select aria-label="Sequence to add them to" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-8">
              <option value="">Add to a sequence…</option>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={!choice || enroll.isPending} onClick={() => enroll.mutate()}>
              Add
            </Button>
          </div>
        )}
        {enroll.data && (
          <p role="status" className="text-xs">
            {enroll.data.enrolled ? 'Added. The first email goes out in the next send window.' : `Not added: ${skipped ? ENROLL_SKIP_LABELS[skipped.reason] : 'skipped'}.`}
          </p>
        )}
        <ErrorText error={enroll.error} />
      </CardContent>
    </Card>
  );
}
