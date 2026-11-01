'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import type { DealRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DealIntelligenceCard, ProposalButton } from '@/components/ai/record-ai';
import { MeetingNotesButton, RecordMeetings } from '@/components/meetings/record-meetings';
import { RecordZoomMeetings } from '@/components/meetings/zoom-meetings';
import { DealHealthTrend } from '@/components/crm/deal-health-trend';
import { RecordConversations } from '@/components/crm/record-conversations';
import { PriorityBadge, RiskIndicator } from '@/components/deals/deal-badges';
import { StageStepper } from '@/components/deals/stage-stepper';
import { CustomFieldList, DetailError, DetailList, DetailSkeleton, RecordHeader } from '@/components/crm/record-detail';
import { RecordIntelligencePanel } from '@/components/crm/record-intelligence';
import { ActivityTimeline, RecordTasks } from '@/components/crm/timeline';
import { DealQuotes } from '@/components/revenue/record-commercial';
import { RecordVoiceNotes } from '@/components/voice/voice-note';
import { api } from '@/lib/api';
import { DEAL_STATUS_TONE, formatDate, formatMoney, titleCase, useRecord } from '@/lib/crm';
import { useCan } from '@/lib/session';

export function DealDetail({ id }: { id: string }) {
  const deal = useRecord<DealRow>('deals', id);
  const canWrite = useCan('deals:write');
  const router = useRouter();
  const qc = useQueryClient();
  const clone = useMutation({
    mutationFn: () => api<DealRow>(`/deals/${id}/clone`, { method: 'POST' }),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: ['deals'] });
      router.push(`/app/deals/${row.id}`);
    },
  });

  if (deal.isPending) return <DetailSkeleton />;
  if (deal.error) return <DetailError error={deal.error} />;
  const d = deal.data;

  return (
    <div className="max-w-6xl">
      <RecordHeader
        entity="deals"
        id={id}
        title={d.name}
        subtitle={`${formatMoney(d.amount, d.currency)} · ${d.pipeline.name}`}
        row={d as unknown as Record<string, unknown>}
        badges={
          <>
            <Badge tone={DEAL_STATUS_TONE[d.status]}>{titleCase(d.status)}</Badge>
            <PriorityBadge priority={d.priority} />
            <RiskIndicator health={d.health} />
          </>
        }
        actions={
          <>
            <ProposalButton dealId={id} />
            <MeetingNotesButton target={{ dealId: id }} label="Meeting notes" />
            {canWrite && (
              <Button variant="outline" size="sm" onClick={() => clone.mutate()} disabled={clone.isPending}>
                <Copy aria-hidden /> Clone
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <h2 className="sr-only">Stage</h2>
          <StageStepper deal={d} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ['Amount', formatMoney(d.amount, d.currency)],
                  ['Probability', `${d.effectiveProbability}%${d.probability === null ? ' (from stage)' : ''}`],
                  ['Expected close', formatDate(d.expectedCloseDate)],
                  ['Closed', d.closedAt ? formatDate(d.closedAt) : null],
                  ['Loss reason', d.lossReason],
                  ['Priority', d.priority ? titleCase(d.priority) : 'Not set'],
                  ['Company', d.company && <Link className="text-primary hover:underline" href={`/app/companies/${d.company.id}`}>{d.company.name}</Link>],
                  ['Primary contact', d.contact && <Link className="text-primary hover:underline" href={`/app/contacts/${d.contact.id}`}>{d.contact.name}</Link>],
                  ['Owner', d.owner?.name],
                  ['Source lead', d.sourceLeadId && <Link className="text-primary hover:underline" href={`/app/leads/${d.sourceLeadId}`}>View lead</Link>],
                  ['Created', formatDate(d.createdAt)],
                ]}
              />
            </CardContent>
          </Card>
          <DealQuotes deal={{ id, name: d.name }} />
          <RecordConversations dealId={id} />
          <RecordMeetings target={{ dealId: id }} />
          <RecordZoomMeetings target={{ dealId: id }} />
          <RecordVoiceNotes record={{ type: 'deal', id, name: d.name }} />
          <ActivityTimeline related={{ opportunityId: id }} timeline={{ entity: 'deal', id }} />
        </div>
        <div className="space-y-4">
          <DealHealthTrend dealId={id} />
          <RecordIntelligencePanel entity="deal" id={id} name={d.name} />
          <DealIntelligenceCard dealId={id} />
          <RecordTasks related={{ opportunityId: id }} />
          <CustomFieldList entity="deals" values={d.customFields} />
        </div>
      </div>
    </div>
  );
}
